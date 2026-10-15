/**
 * @jest-environment node
 *
 * LUM-1148 — pre-merge checks in the PR write-back: the summary carries the
 * checks; with the request-changes workflow on, a failed `error` check keeps
 * Lumo at "Changes requested" (never an approval) until it passes or the PR
 * overrides the checks; a `warning` or an inconclusive check never blocks.
 */
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      createIssueComment: jest.fn().mockResolvedValue({ id: 55 }),
      updateIssueComment: jest.fn(),
      createReview: jest.fn().mockResolvedValue({ id: 77 }),
      updateReviewLineComment: jest.fn(),
      listIssueComments: jest.fn().mockResolvedValue([]),
      listReviewComments: jest.fn(),
      createReviewLineReply: jest.fn().mockResolvedValue({ id: 1 }),
      listReviewCommentsOfReview: jest.fn().mockResolvedValue([]),
      listReviews: jest.fn(),
      submitReview: jest.fn().mockResolvedValue({ id: 900 }),
      dismissReview: jest.fn().mockResolvedValue(undefined),
      getPullRequestHead: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/review-threads', () => ({
  reviewThreadClient: {
    listReviewThreads: jest.fn(),
    resolveThread: jest.fn().mockResolvedValue(undefined),
    unresolveThread: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByIdForReview: jest.fn(),
    hasNewerScanThan: jest.fn().mockResolvedValue(false),
    findSummaryCommentIdByPullRequest: jest.fn().mockResolvedValue(null),
    isPullRequestHeldElsewhere: jest.fn().mockResolvedValue(false),
    isRequestChangesOnElsewhere: jest.fn().mockResolvedValue(false),
    setSummaryCommentId: jest.fn(),
  },
}))
jest.mock('@/ee/security/repositories/pr-finding-thread.repository', () => ({
  prFindingThreadRepository: {
    findByPullRequest: jest.fn(),
    upsert: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    findLayerMetaByFingerprints: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: jest.fn().mockResolvedValue({ scan: true }),
}))
jest.mock('@/ee/security/services/scan-evidence-retention.service', () => ({
  scrubScanIfZeroRetention: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { reviewThreadClient } from '@/lib/integrations/github/review-threads'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { prFindingThreadRepository } from '@/ee/security/repositories/pr-finding-thread.repository'
import type {
  PreMergeCheckResult,
  PreMergeChecksRecord,
} from '@/ee/security/security-scan/pre-merge-checks'

const findById = prSecurityScanRepository.findByIdForReview as jest.Mock
const listReview = prCommentClient.listReviewComments as jest.Mock
const threadRows = prFindingThreadRepository.findByPullRequest as jest.Mock
const listThreads = reviewThreadClient.listReviewThreads as jest.Mock
const submitReview = prCommentClient.submitReview as jest.Mock
const listReviews = prCommentClient.listReviews as jest.Mock
const liveHead = prCommentClient.getPullRequestHead as jest.Mock
const createComment = prCommentClient.createIssueComment as jest.Mock

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const events = () => submitReview.mock.calls.map(c => c[0].event)
const summaryBody = (): string => createComment.mock.calls[0]?.[0].body ?? ''

function result(over: Partial<PreMergeCheckResult> = {}): PreMergeCheckResult {
  return {
    id: 'title',
    name: 'Title',
    kind: 'builtin',
    mode: 'error',
    verdict: 'failed',
    explanation: 'The title "update" does not say what changed.',
    resolution: 'Name the change, e.g. "fix: retry webhook delivery".',
    ...over,
  }
}

function record(results: PreMergeCheckResult[]): PreMergeChecksRecord {
  return { headSha: HEAD, ranAt: '2026-10-15T00:00:00Z', results }
}

function scanRow(opts: {
  checks?: PreMergeChecksRecord | null
  requestChanges?: boolean
  override?: { by: string; sha: string } | null
}) {
  return {
    id: 's1',
    headSha: HEAD,
    status: 'CLEAN',
    stages: { secrets: 'RAN', judge: 'RAN' },
    partial: false,
    error: null,
    summaryCommentId: null,
    suggestedAt: new Date('2026-10-01T00:00:00Z'),
    verifierStartedAt: null,
    verifiedAt: null,
    judgeReviewScope: null,
    preMergeChecks: opts.checks ?? null,
    findings: [],
    pullRequest: {
      id: 'pr1',
      repo: 'acme/app',
      number: 9,
      state: 'open',
      workspaceId: 'w1',
      preMergeOverrideBy: opts.override?.by ?? null,
      preMergeOverrideAt: opts.override
        ? new Date('2026-10-15T01:00:00Z')
        : null,
      preMergeOverrideSha: opts.override?.sha ?? null,
      task: null,
      workspace: {
        slug: 'acme',
        securityPolicy: null,
        securityRequestChangesEnabled: opts.requestChanges ?? true,
      },
    },
  }
}

const prevSlug = process.env.GITHUB_APP_SLUG
beforeAll(() => {
  process.env.GITHUB_APP_SLUG = 'uselumo'
})
afterAll(() => {
  if (prevSlug === undefined) delete process.env.GITHUB_APP_SLUG
  else process.env.GITHUB_APP_SLUG = prevSlug
})

beforeEach(() => {
  jest.clearAllMocks()
  listReview.mockResolvedValue([])
  listThreads.mockResolvedValue([])
  threadRows.mockResolvedValue([])
  listReviews.mockResolvedValue([])
  liveHead.mockResolvedValue({ sha: HEAD, state: 'open' })
})

describe('LUM-1148 pre-merge checks ⇒ verdict (request-changes workflow on)', () => {
  it('a failed `error` title check ⇒ changes requested, never an approval', async () => {
    findById.mockResolvedValue(scanRow({ checks: record([result()]) }))
    await securityPrReviewService.syncReview('s1')
    expect(events()).toEqual(['REQUEST_CHANGES'])
    expect(submitReview.mock.calls[0][0].body).toMatch(
      /1 failed pre-merge check\b/
    )
    expect(summaryBody()).toMatch(/\*\*Pre-merge checks:\*\* 1 error/)
    expect(summaryBody()).toMatch(/\| Title \| ❌ Error \|/)
    expect(summaryBody()).toContain('`@uselumo ignore pre-merge checks`')
  })

  it('the same check as `warning` ⇒ reported, and the head is approved', async () => {
    findById.mockResolvedValue(
      scanRow({ checks: record([result({ mode: 'warning' })]) })
    )
    await securityPrReviewService.syncReview('s1')
    expect(events()).toEqual(['APPROVE'])
    expect(summaryBody()).toMatch(/\| Title \| ⚠️ Warning \|/)
  })

  it('an inconclusive `error` check never blocks', async () => {
    findById.mockResolvedValue(
      scanRow({
        checks: record([result({ verdict: 'inconclusive', resolution: null })]),
      })
    )
    await securityPrReviewService.syncReview('s1')
    expect(events()).toEqual(['APPROVE'])
    expect(summaryBody()).toMatch(/❔ Inconclusive/)
  })

  it('overridden on the PR ⇒ the failure shows as ignored and Lumo approves', async () => {
    findById.mockResolvedValue(
      scanRow({
        checks: record([result()]),
        override: { by: 'reviewer-1', sha: HEAD },
      })
    )
    await securityPrReviewService.syncReview('s1')
    expect(events()).toEqual(['APPROVE'])
    expect(summaryBody()).toMatch(/⏭️ Ignored/)
    expect(summaryBody()).toMatch(/overridden by reviewer-1 at `abcdef1`/)
  })

  it('an override is per PR: given at an earlier head, it still covers this one', async () => {
    findById.mockResolvedValue(
      scanRow({
        checks: record([result()]),
        override: { by: 'reviewer-1', sha: '1'.repeat(40) },
      })
    )
    await securityPrReviewService.syncReview('s1')
    expect(events()).toEqual(['APPROVE'])
    expect(summaryBody()).toMatch(/⏭️ Ignored/)
    expect(summaryBody()).toMatch(
      /overridden by reviewer-1 at `1111111`; it covers every later push to this PR/
    )
  })

  it('a passed `error` check ⇒ folded under "Passed checks", approved', async () => {
    findById.mockResolvedValue(
      scanRow({
        checks: record([result({ verdict: 'passed', resolution: null })]),
      })
    )
    await securityPrReviewService.syncReview('s1')
    expect(events()).toEqual(['APPROVE'])
    expect(summaryBody()).toMatch(/<summary>Passed checks \(1\)<\/summary>/)
  })

  it('results of another head never count', async () => {
    findById.mockResolvedValue(
      scanRow({
        checks: { ...record([result()]), headSha: '1'.repeat(40) },
      })
    )
    await securityPrReviewService.syncReview('s1')
    expect(events()).toEqual(['APPROVE'])
    expect(summaryBody()).not.toMatch(/Pre-merge checks/)
  })

  it('no checks ran (all off) ⇒ no block, no section', async () => {
    findById.mockResolvedValue(scanRow({ checks: null }))
    await securityPrReviewService.syncReview('s1')
    expect(events()).toEqual(['APPROVE'])
    expect(summaryBody()).not.toMatch(/Pre-merge checks/)
  })
})

describe('LUM-1148 with the request-changes workflow off', () => {
  it('a failed `error` check is reported, nothing is requested or approved', async () => {
    findById.mockResolvedValue(
      scanRow({ checks: record([result()]), requestChanges: false })
    )
    await securityPrReviewService.syncReview('s1')
    expect(submitReview).not.toHaveBeenCalled()
    expect(summaryBody()).toMatch(/workflow on \(it is off in this workspace\)/)
  })
})
