/**
 * @jest-environment node
 *
 * LUM-1148 — `@<app> ignore pre-merge checks`: recorded once per PR (who,
 * when, at which head) and the review refreshed; with the repository's
 * reviewers-only switch the PR's author is refused and only a requested
 * reviewer may; `approve` is refused while an `error` check fails, until the
 * PR overrides the checks. An override never touches findings.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/integrations/github/collaborator-access', () => ({
  checkRepositoryWriteAccess: jest.fn(),
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrDetails: jest.fn(),
}))
jest.mock('@/lib/integrations/github/pr-comment-client', () => ({
  prCommentClient: {
    createIssueComment: jest.fn().mockResolvedValue({ id: 900 }),
    listIssueCommentsSince: jest.fn().mockResolvedValue([]),
    getPullRequestHead: jest.fn(),
    listReviews: jest.fn().mockResolvedValue([]),
    submitReview: jest.fn().mockResolvedValue({ id: 901 }),
    dismissReview: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/integrations/github/review-threads', () => ({
  reviewThreadClient: {
    listReviewThreads: jest.fn().mockResolvedValue([]),
    resolveThread: jest.fn().mockResolvedValue(undefined),
    unresolveThread: jest.fn(),
  },
}))
jest.mock('@/ee/security/services/pr-review-control.service', () => ({
  prReviewControlService: { act: jest.fn() },
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findLatestByPullRequestIds: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findSecurityPolicy: jest.fn().mockResolvedValue(null),
    findRequestChangesEnabled: jest.fn().mockResolvedValue(true),
    findAllowAuthorApproval: jest.fn().mockResolvedValue(true),
  },
}))
jest.mock('@/ee/security/repositories/pr-finding-thread.repository', () => ({
  prFindingThreadRepository: {
    findByPullRequest: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/ee/security/repositories/pre-merge-override.repository', () => ({
  preMergeOverrideRepository: { find: jest.fn(), record: jest.fn() },
}))
jest.mock('@/ee/security/services/pre-merge-checks.service', () => ({
  preMergeChecksService: { resolveSetting: jest.fn() },
}))
jest.mock('@/ee/security/services/security-pr-review.service', () => ({
  securityPrReviewService: { sync: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {},
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import {
  applyPrCommentCommand,
  buildHelpReply,
  type PrCommentEvent,
} from '@/ee/security/services/pr-command.service'
import { parsePrCommand } from '@/ee/security/services/pr-command-parse'
import { checkRepositoryWriteAccess } from '@/lib/integrations/github/collaborator-access'
import { fetchPrDetails } from '@/lib/integrations/github/contents'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import { preMergeOverrideRepository } from '@/ee/security/repositories/pre-merge-override.repository'
import { preMergeChecksService } from '@/ee/security/services/pre-merge-checks.service'
import { securityPrReviewService } from '@/ee/security/services/security-pr-review.service'
import { parsePreMergeChecksSetting } from '@/ee/security/security-scan/pre-merge-checks'

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const OLD_SLUG = process.env.GITHUB_APP_SLUG
const access = checkRepositoryWriteAccess as jest.Mock
const details = fetchPrDetails as jest.Mock
const reply = prCommentClient.createIssueComment as jest.Mock
const listReviews = prCommentClient.listReviews as jest.Mock
const submitReview = prCommentClient.submitReview as jest.Mock
const liveHead = prCommentClient.getPullRequestHead as jest.Mock
const latest = prSecurityScanRepository.findLatestByPullRequestIds as jest.Mock
const allowAuthor =
  securityColumnsRepository.findAllowAuthorApproval as jest.Mock
const findOverride = preMergeOverrideRepository.find as jest.Mock
const record = preMergeOverrideRepository.record as jest.Mock
const resolveSetting = preMergeChecksService.resolveSetting as jest.Mock
const sync = securityPrReviewService.sync as jest.Mock

const replyBody = (): string =>
  (reply.mock.calls[0]![0] as { body: string }).body

function event(body: string, login = 'carol'): PrCommentEvent {
  return {
    workspaceId: 'w1',
    pullRequestId: 'pr1',
    repo: 'acme/app',
    prNumber: 9,
    action: 'created',
    comment: {
      id: 556,
      body,
      createdAt: '2026-10-15T08:00:00Z',
      user: { login, type: 'User' },
    },
    prAuthorLogin: 'bob',
  }
}

function reviewersOnly(on: boolean) {
  resolveSetting.mockResolvedValue({
    setting: {
      ...parsePreMergeChecksSetting(null),
      overrideRequestedReviewersOnly: on,
    },
    pathFilters: [],
  })
}

const failingTitle = {
  headSha: HEAD,
  ranAt: '2026-10-15T00:00:00Z',
  results: [
    {
      id: 'title',
      name: 'Title',
      kind: 'builtin',
      mode: 'error',
      verdict: 'failed',
      explanation: 'Vague.',
      resolution: 'Rename.',
    },
  ],
}

const IGNORE = '@uselumo ignore pre-merge checks'

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GITHUB_APP_SLUG = 'uselumo'
  access.mockResolvedValue('write')
  allowAuthor.mockResolvedValue(true)
  details.mockResolvedValue({
    title: 'update',
    body: '',
    authorLogin: 'bob',
    state: 'open',
    headSha: HEAD,
    baseRef: 'main',
    baseSha: 'b'.repeat(40),
    requestedReviewers: ['dave'],
  })
  reviewersOnly(false)
  findOverride.mockResolvedValue(null)
  record.mockImplementation(async (_id: string, i: { login: string }) => ({
    override: { login: i.login, at: new Date(), headSha: HEAD },
    recorded: true,
  }))
  latest.mockResolvedValue([
    { id: 's1', headSha: HEAD, findings: [], preMergeChecks: failingTitle },
  ])
  liveHead.mockResolvedValue({ sha: HEAD, state: 'open' })
  listReviews.mockResolvedValue([])
})

afterAll(() => {
  if (OLD_SLUG === undefined) delete process.env.GITHUB_APP_SLUG
  else process.env.GITHUB_APP_SLUG = OLD_SLUG
})

it('parses the command and lists it in the help reply', () => {
  expect(
    parsePrCommand('@uselumo Ignore pre-merge checks.', '@uselumo')
  ).toEqual({
    command: 'ignore pre-merge checks',
    text: 'ignore pre-merge checks',
  })
  expect(buildHelpReply('@uselumo', null)).toContain(`\`${IGNORE}\``)
})

it('records the override for this PR (who, head) and refreshes the review', async () => {
  await expect(applyPrCommentCommand(event(IGNORE))).resolves.toBe('done')
  expect(record).toHaveBeenCalledWith('pr1', { login: 'carol', headSha: HEAD })
  expect(sync).toHaveBeenCalledWith('s1')
  expect(replyBody()).toMatch(/override by carol at `abcdef1` recorded/)
  expect(replyBody()).toMatch(
    /findings that block DONE still need a disposition/
  )
})

it('a second override on the same PR is a no-op that names the first', async () => {
  findOverride.mockResolvedValue({
    login: 'erin',
    at: new Date(),
    headSha: HEAD,
  })
  await expect(applyPrCommentCommand(event(IGNORE))).resolves.toBe('done')
  expect(record).not.toHaveBeenCalled()
  expect(replyBody()).toMatch(/already overridden by erin/)
})

it('no write access ⇒ ignored silently', async () => {
  access.mockResolvedValue('read')
  await expect(applyPrCommentCommand(event(IGNORE))).resolves.toBe(
    'unauthorized'
  )
  expect(record).not.toHaveBeenCalled()
  expect(reply).not.toHaveBeenCalled()
})

describe('reviewers-only override', () => {
  beforeEach(() => reviewersOnly(true))

  it('refuses the PR author — even one listed as a requested reviewer', async () => {
    details.mockResolvedValue({
      ...(await details()),
      requestedReviewers: ['bob'],
    })
    await expect(applyPrCommentCommand(event(IGNORE, 'bob'))).resolves.toBe(
      'refused_author'
    )
    expect(record).not.toHaveBeenCalled()
    expect(replyBody()).toMatch(/author can't override/)
  })

  it('refuses a writer who is not a requested reviewer', async () => {
    await expect(applyPrCommentCommand(event(IGNORE, 'carol'))).resolves.toBe(
      'refused_not_reviewer'
    )
    expect(record).not.toHaveBeenCalled()
  })

  it('a requested reviewer may', async () => {
    await expect(applyPrCommentCommand(event(IGNORE, 'dave'))).resolves.toBe(
      'done'
    )
    expect(record).toHaveBeenCalled()
  })

  it('a reviewer who already reviewed (no longer listed as requested) may', async () => {
    listReviews.mockResolvedValue([
      {
        id: 1,
        state: 'COMMENTED',
        commit_id: HEAD,
        user: { login: 'carol', type: 'User' },
      },
    ])
    await expect(applyPrCommentCommand(event(IGNORE, 'carol'))).resolves.toBe(
      'done'
    )
  })
})

it('without reviewers-only, the author may unless author approval is off', async () => {
  await expect(applyPrCommentCommand(event(IGNORE, 'bob'))).resolves.toBe(
    'done'
  )
  jest.clearAllMocks()
  access.mockResolvedValue('write')
  allowAuthor.mockResolvedValue(false)
  await expect(applyPrCommentCommand(event(IGNORE, 'bob'))).resolves.toBe(
    'refused_author'
  )
})

describe('approve and the checks', () => {
  it('refused while an `error` check fails — nothing approved', async () => {
    await expect(
      applyPrCommentCommand(event('@uselumo approve'))
    ).resolves.toBe('refused_checks')
    expect(submitReview).not.toHaveBeenCalled()
    expect(replyBody()).toMatch(/1 `error` pre-merge check fails/)
    expect(replyBody()).toContain(`\`${IGNORE}\``)
  })

  it('allowed once the PR overrode the checks', async () => {
    findOverride.mockResolvedValue({
      login: 'dave',
      at: new Date(),
      headSha: HEAD,
    })
    await expect(
      applyPrCommentCommand(event('@uselumo approve'))
    ).resolves.toBe('done')
    expect(submitReview).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'APPROVE' })
    )
  })

  it('an inconclusive `error` check does not refuse', async () => {
    latest.mockResolvedValue([
      {
        id: 's1',
        headSha: HEAD,
        findings: [],
        preMergeChecks: {
          ...failingTitle,
          results: [{ ...failingTitle.results[0], verdict: 'inconclusive' }],
        },
      },
    ])
    await expect(
      applyPrCommentCommand(event('@uselumo approve'))
    ).resolves.toBe('done')
  })
})
