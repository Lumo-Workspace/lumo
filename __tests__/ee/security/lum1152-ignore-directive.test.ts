/**
 * @jest-environment node
 *
 * LUM-1152 — `@<app> ignore` in a PR description: the pure directive match,
 * its live read (fail-open), the summary / CLI / web wording of an ignored
 * head, and the task-less `pull_request.edited` path (an edit that only adds
 * or removes the directive starts nothing). The scan itself — AI layers
 * skipped, deterministic layers kept, manual review unaffected — is in
 * pr-security-scan.service.test.ts.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrBody: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {},
}))

import {
  hasIgnoreDirective,
  decideTasklessAutoReview,
  DEFAULT_REPO_REVIEW_SETTING,
  UNKNOWN_PR_FACTS,
} from '@/ee/security/security-scan/auto-review-policy'
import { isPrReviewIgnored } from '@/ee/security/services/pr-ignore-directive'
import {
  buildSummary,
  commandsBlock,
} from '@/ee/security/services/security-pr-review.service'
import { buildHelpReply } from '@/ee/security/services/pr-command.service'
import { stageReason } from '@/ee/security/components/TaskDetailTimeline/security-summary'
import {
  heldStageLabel,
  IGNORED_STAGE_LABEL,
  isOwnedUnfinished,
  isReviewIgnored,
  PARTIAL_CAUSE_CLASS,
  RATE_LIMITED_STAGE_LABEL,
} from '@/shared/src/security-scan'
import { scanLayerRows } from '@/cli/src/lib/scan-format'
import * as gh from '@/lib/integrations/github/contents'

const fetchPrBody = gh.fetchPrBody as jest.Mock
const H = '@uselumo'

describe('hasIgnoreDirective', () => {
  test.each([
    ['@uselumo ignore', true],
    ['Some text.\n\n@uselumo ignore', true],
    ['please @uselumo ignore this one', true],
    ['@USELUMO Ignore', true],
    ['@uselumo[bot] ignore.', true],
    ['@uselumo: ignore', true],
    ['<!-- @uselumo ignore -->', true],
    ['@uselumo review', false],
    ['@uselumo ignored', false],
    ['@uselumo ignore-me', false],
    ['@uselumo-test ignore', false],
    ['x@uselumo ignore', false],
    ['Use `@uselumo ignore` to skip a review.', false],
    ['```\n@uselumo ignore\n```', false],
    ['> @uselumo ignore', false],
    ['', false],
  ])('%j → %s', (body, expected) => {
    expect(hasIgnoreDirective(body, H)).toBe(expected)
  })

  test('no body or no configured handle = no directive', () => {
    expect(hasIgnoreDirective(null, H)).toBe(false)
    expect(hasIgnoreDirective('@uselumo ignore', null)).toBe(false)
  })

  test('the handle is matched literally', () => {
    expect(hasIgnoreDirective('@a.b ignore', '@a.b')).toBe(true)
    expect(hasIgnoreDirective('@axb ignore', '@a.b')).toBe(false)
  })
})

describe('isPrReviewIgnored (live description, fail-open)', () => {
  const pr = { workspaceId: 'w1', repo: 'o/r', number: 7 }
  const prev = process.env.GITHUB_APP_SLUG
  beforeEach(() => {
    fetchPrBody.mockReset()
    process.env.GITHUB_APP_SLUG = 'uselumo'
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.GITHUB_APP_SLUG
    else process.env.GITHUB_APP_SLUG = prev
  })

  test('reads the description through the pulls API', async () => {
    fetchPrBody.mockResolvedValue('WIP\n@uselumo ignore')
    await expect(isPrReviewIgnored(pr)).resolves.toBe(true)
    expect(fetchPrBody).toHaveBeenCalledWith({
      workspaceId: 'w1',
      fullName: 'o/r',
      prNumber: 7,
    })
  })

  test('removed from the description = reviewed again', async () => {
    fetchPrBody.mockResolvedValue('WIP')
    await expect(isPrReviewIgnored(pr)).resolves.toBe(false)
  })

  test('an unreadable description is reviewed (fail-open)', async () => {
    fetchPrBody.mockRejectedValue(new Error('GitHub API error 502'))
    await expect(isPrReviewIgnored(pr)).resolves.toBe(false)
  })

  test('no App slug: no directive and no GitHub call', async () => {
    delete process.env.GITHUB_APP_SLUG
    await expect(isPrReviewIgnored(pr)).resolves.toBe(false)
    expect(fetchPrBody).not.toHaveBeenCalled()
  })
})

describe('an ignored head, in words', () => {
  const base = {
    headSha: 'abcdef1234567890',
    stages: { secrets: 'RAN', judge: 'PAUSED', hunt: 'PAUSED' } as never,
    status: 'CLEAN' as const,
    partial: true,
    externalCounts: {},
    open: 0,
    blocking: 0,
    error: null,
    taskUrl: null,
    repo: 'acme/app',
    prNumber: 9,
    commandHandle: H,
  }

  test('the cause is user-controlled and a review hold', () => {
    expect(PARTIAL_CAUSE_CLASS.AI_REVIEW_IGNORED).toBe('USER_CONTROLLED')
    expect(isReviewIgnored(['AI_REVIEW_IGNORED'])).toBe(true)
    expect(isReviewIgnored(['AI_REVIEW_PAUSED'])).toBe(false)
    expect(heldStageLabel(['AI_REVIEW_IGNORED'])).toBe(IGNORED_STAGE_LABEL)
    expect(heldStageLabel(['AI_REVIEW_RATE_LIMITED'])).toBe(
      RATE_LIMITED_STAGE_LABEL
    )
    expect(heldStageLabel(['AI_REVIEW_PAUSED'])).toBeNull()
    expect(
      isOwnedUnfinished({
        status: 'CLEAN',
        stages: base.stages,
        partial: true,
        partialCauses: ['AI_REVIEW_IGNORED'],
        hasSizeNotice: false,
      })
    ).toBe(false)
  })

  test('the PR summary says why the AI review was skipped and how to get one', () => {
    const body = buildSummary({ ...base, partialCauses: ['AI_REVIEW_IGNORED'] })
    expect(body).toContain('Automatic AI review is skipped')
    expect(body).toContain('contains `@uselumo ignore`')
    expect(body).toContain('next push reviewed')
    expect(body).toContain('`@uselumo review`')
    expect(body).toContain(IGNORED_STAGE_LABEL)
    expect(body).not.toMatch(/paused on this PR/)
    expect(body).not.toMatch(/rate-limited/)
  })

  test('the CLI layer rows say so', () => {
    const rows = scanLayerRows({
      stages: { secrets: 'RAN', judge: 'PAUSED' },
      externalFindings: 0,
      partialCauses: ['AI_REVIEW_IGNORED'],
    } as never)
    expect(rows.map(r => r.value)).toContain(IGNORED_STAGE_LABEL)
  })

  test('web stage reason', () => {
    const scan = {
      stages: { judge: 'PAUSED' } as never,
      huntOverCap: null,
      judgeOverCap: null,
      judgePartial: null,
      huntProgress: null,
    }
    expect(stageReason('judge', { ...scan, reviewIgnored: true })?.id).toBe(
      'securityScan.stageReason.IGNORED'
    )
  })

  test('the commands block and the help reply name the directive', () => {
    expect(commandsBlock(H)).toContain('`@uselumo ignore`')
    expect(buildHelpReply(H, null)).toContain('`@uselumo ignore`')
  })
})

describe('task-less pull_request.edited', () => {
  const confirming = [
    {
      workspaceId: 'w1',
      confirmedAt: new Date('2026-01-01'),
      setting: { ...DEFAULT_REPO_REVIEW_SETTING },
    },
  ]
  const facts = (body: string) => ({ ...UNKNOWN_PR_FACTS, body })
  const edit = (before: string, after: string) =>
    decideTasklessAutoReview({
      action: 'edited',
      state: 'open',
      isDraft: false,
      pr: facts(after),
      before: facts(before),
      workspaceId: 'w1',
      confirming,
      linkedElsewhere: false,
    })

  test('adding or removing the directive alone starts no review', () => {
    expect(edit('x', 'x\n@uselumo ignore')).toEqual({
      review: false,
      reason: 'not_newly_matching',
    })
    expect(edit('x\n@uselumo ignore', 'x')).toEqual({
      review: false,
      reason: 'not_newly_matching',
    })
  })

  test('a push to a PR carrying the directive is still dispatched (the scan skips only the AI layers)', () => {
    expect(
      decideTasklessAutoReview({
        action: 'synchronize',
        state: 'open',
        isDraft: false,
        pr: facts('@uselumo ignore'),
        workspaceId: 'w1',
        confirming,
        linkedElsewhere: false,
      })
    ).toEqual({ review: true })
  })
})
