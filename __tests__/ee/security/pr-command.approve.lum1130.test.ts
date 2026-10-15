/**
 * @jest-environment node
 *
 * LUM-1130 — `@<app> approve`: request-changes workflow only; refused while
 * a finding blocks DONE (even one whose thread was resolved on GitHub) and
 * for the PR's own author; otherwise resolves Lumo's threads, approves the
 * PR's live head and dismisses Lumo's earlier change requests. A refused
 * approve has no side effect.
 */
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn().mockResolvedValue('tok'),
}))
jest.mock('@/lib/integrations/github/collaborator-access', () => ({
  checkRepositoryWriteAccess: jest.fn(),
}))
jest.mock('@/lib/integrations/github/pr-comment-client', () => ({
  prCommentClient: {
    createIssueComment: jest.fn().mockResolvedValue({ id: 900 }),
    listIssueCommentsSince: jest.fn().mockResolvedValue([]),
    getPullRequestHead: jest.fn(),
    listReviews: jest.fn(),
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
    findRequestChangesEnabled: jest.fn(),
    findAllowAuthorApproval: jest.fn(),
  },
}))
jest.mock('@/ee/security/repositories/pr-finding-thread.repository', () => ({
  prFindingThreadRepository: {
    findByPullRequest: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {},
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import {
  applyPrCommentCommand,
  buildApproveReply,
  buildHelpReply,
  type PrCommentEvent,
} from '@/ee/security/services/pr-command.service'
import { parsePrCommand } from '@/ee/security/services/pr-command-parse'
import { checkRepositoryWriteAccess } from '@/lib/integrations/github/collaborator-access'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { reviewThreadClient } from '@/lib/integrations/github/review-threads'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { prFindingThreadRepository } from '@/ee/security/repositories/pr-finding-thread.repository'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'

const access = checkRepositoryWriteAccess as jest.Mock
const reply = prCommentClient.createIssueComment as jest.Mock
const liveHead = prCommentClient.getPullRequestHead as jest.Mock
const listReviews = prCommentClient.listReviews as jest.Mock
const submitReview = prCommentClient.submitReview as jest.Mock
const dismissReview = prCommentClient.dismissReview as jest.Mock
const resolveThread = reviewThreadClient.resolveThread as jest.Mock
const findRows = prFindingThreadRepository.findByPullRequest as jest.Mock
const latest = prSecurityScanRepository.findLatestByPullRequestIds as jest.Mock
const modeOn = securityColumnsRepository.findRequestChangesEnabled as jest.Mock
const allowAuthor =
  securityColumnsRepository.findAllowAuthorApproval as jest.Mock

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12'
const OLD_SLUG = process.env.GITHUB_APP_SLUG
const lumoBot = { login: 'uselumo[bot]', type: 'Bot' }

function event(body: string, login = 'alice'): PrCommentEvent {
  return {
    workspaceId: 'w1',
    pullRequestId: 'pr1',
    repo: 'acme/app',
    prNumber: 9,
    action: 'created',
    comment: {
      id: 555,
      body,
      createdAt: '2026-10-14T08:00:00Z',
      user: { login, type: 'User' },
    },
    prAuthorLogin: 'bob',
  }
}

const row = (fingerprint: string, state = 'OPEN') => ({
  id: `row-${fingerprint}`,
  pullRequestId: 'pr1',
  fingerprint,
  commentId: '101',
  threadNodeId: `T-${fingerprint}`,
  state,
  ruleId: 'r',
  provenance: 'LLM_JUDGE',
  kind: 'VULNERABILITY',
  filePath: 'a.ts',
  resolvedByLogin: null,
  addressedInSha: null,
})

const replyBody = (): string =>
  (reply.mock.calls[0]![0] as { body: string }).body

beforeEach(() => {
  jest.clearAllMocks()
  process.env.GITHUB_APP_SLUG = 'uselumo'
  // LUM-1127: thread mutations get their own token (pull_requests + contents write).
  ;(getRepoToken as jest.Mock).mockImplementation(
    async (_w: string, _r: string, perms: object) =>
      perms === REPO_TOKEN_PERMISSIONS.reviewThreadWrite ? 'thread-tok' : 'tok'
  )
  access.mockResolvedValue('write')
  modeOn.mockResolvedValue(true)
  allowAuthor.mockResolvedValue(true)
  latest.mockResolvedValue([{ id: 's1', headSha: HEAD, findings: [] }])
  findRows.mockResolvedValue([row('fpLow')])
  liveHead.mockResolvedValue({ sha: HEAD, state: 'open' })
  listReviews.mockResolvedValue([
    { id: 41, state: 'CHANGES_REQUESTED', commit_id: 'old', user: lumoBot },
  ])
})

afterAll(() => {
  if (OLD_SLUG === undefined) delete process.env.GITHUB_APP_SLUG
  else process.env.GITHUB_APP_SLUG = OLD_SLUG
})

it('parses `approve` and lists it in the help reply', () => {
  expect(parsePrCommand('@uselumo approve', '@uselumo')).toEqual({
    command: 'approve',
    text: 'approve',
  })
  expect(buildHelpReply('@uselumo', null)).toContain('`@uselumo approve`')
})

it('resolves open threads, approves the live head and dismisses Lumo’s change request', async () => {
  await expect(applyPrCommentCommand(event('@uselumo approve'))).resolves.toBe(
    'done'
  )
  // Threads resolve with the reviewThreadWrite token, as `resolve` does…
  expect(resolveThread).toHaveBeenCalledWith({
    threadId: 'T-fpLow',
    token: 'thread-tok',
  })
  // …the review itself with the pull-request write token.
  expect(submitReview.mock.calls[0][0].token).toBe('tok')
  expect(submitReview).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'APPROVE', commitId: HEAD })
  )
  expect(submitReview.mock.calls[0][0].body).toContain('@alice')
  expect(dismissReview).toHaveBeenCalledWith(
    expect.objectContaining({ reviewId: 41 })
  )
  expect(replyBody()).toContain('Approved `abcdef1`')
})

it('mode off ⇒ refused, nothing resolved, nothing approved', async () => {
  modeOn.mockResolvedValue(false)
  await expect(applyPrCommentCommand(event('@uselumo approve'))).resolves.toBe(
    'refused_mode_off'
  )
  expect(resolveThread).not.toHaveBeenCalled()
  expect(submitReview).not.toHaveBeenCalled()
  expect(replyBody()).toContain('request-changes workflow is off')
})

it('a blocking finding (its thread resolved on GitHub) ⇒ refused, nothing resolved', async () => {
  findRows.mockResolvedValue([row('fpBlock', 'RESOLVED_BY_USER')])
  latest.mockResolvedValue([
    {
      id: 's1',
      headSha: HEAD,
      findings: [
        {
          fingerprint: 'fpBlock',
          provenance: 'DETERMINISTIC',
          severity: 'HIGH',
          disposition: null,
          persisting: false,
        },
      ],
    },
  ])
  await expect(applyPrCommentCommand(event('@uselumo approve'))).resolves.toBe(
    'refused_blocking'
  )
  expect(resolveThread).not.toHaveBeenCalled()
  expect(submitReview).not.toHaveBeenCalled()
  expect(replyBody()).toMatch(/1 finding blocks DONE/)
})

// LUM-1142: author approval — on by default.
it('the PR’s author may approve by default when the preconditions hold', async () => {
  await expect(
    applyPrCommentCommand(event('@uselumo approve', 'bob'))
  ).resolves.toBe('done')
  expect(resolveThread).toHaveBeenCalledWith({
    threadId: 'T-fpLow',
    token: 'thread-tok',
  })
  expect(submitReview).toHaveBeenCalledWith(
    expect.objectContaining({ event: 'APPROVE', commitId: HEAD })
  )
  expect(submitReview.mock.calls[0][0].body).toContain('@bob')
})

it('the PR’s author with author approval off ⇒ refused (same rule as resolve)', async () => {
  allowAuthor.mockResolvedValue(false)
  await expect(
    applyPrCommentCommand(event('@uselumo approve', 'bob'))
  ).resolves.toBe('refused_author')
  expect(resolveThread).not.toHaveBeenCalled()
  expect(submitReview).not.toHaveBeenCalled()
})

it('the PR’s author is still refused while a finding blocks DONE', async () => {
  latest.mockResolvedValue([
    {
      id: 's1',
      headSha: HEAD,
      findings: [
        {
          fingerprint: 'fpBlock',
          provenance: 'DETERMINISTIC',
          severity: 'HIGH',
          disposition: null,
          persisting: false,
        },
      ],
    },
  ])
  await expect(
    applyPrCommentCommand(event('@uselumo approve', 'bob'))
  ).resolves.toBe('refused_blocking')
  expect(resolveThread).not.toHaveBeenCalled()
  expect(submitReview).not.toHaveBeenCalled()
})

it('no write access ⇒ ignored silently', async () => {
  access.mockResolvedValue('read')
  await expect(applyPrCommentCommand(event('@uselumo approve'))).resolves.toBe(
    'unauthorized'
  )
  expect(submitReview).not.toHaveBeenCalled()
  expect(reply).not.toHaveBeenCalled()
})

it('a thread that cannot be resolved ⇒ no approval', async () => {
  resolveThread.mockRejectedValueOnce(new Error('boom'))
  await expect(applyPrCommentCommand(event('@uselumo approve'))).resolves.toBe(
    'failed'
  )
  expect(submitReview).not.toHaveBeenCalled()
})

it('a PR that is no longer open ⇒ no approval, nothing resolved', async () => {
  liveHead.mockResolvedValue({ sha: HEAD, state: 'closed' })
  await expect(applyPrCommentCommand(event('@uselumo approve'))).resolves.toBe(
    'failed'
  )
  expect(resolveThread).not.toHaveBeenCalled()
  expect(submitReview).not.toHaveBeenCalled()
  expect(replyBody()).toContain('not open')
})

it('a head Lumo has not reviewed yet ⇒ refused, nothing resolved', async () => {
  latest.mockResolvedValue([{ id: 's0', headSha: 'old', findings: [] }])
  await expect(applyPrCommentCommand(event('@uselumo approve'))).resolves.toBe(
    'refused_unreviewed'
  )
  expect(resolveThread).not.toHaveBeenCalled()
  expect(submitReview).not.toHaveBeenCalled()
  expect(replyBody()).toContain('latest review is not of `abcdef1`')
})

it('no scan at all ⇒ refused as unreviewed', async () => {
  latest.mockResolvedValue([])
  await expect(applyPrCommentCommand(event('@uselumo approve'))).resolves.toBe(
    'refused_unreviewed'
  )
  expect(submitReview).not.toHaveBeenCalled()
})

it('a push between the resolve and the submit ⇒ no approval', async () => {
  liveHead
    .mockResolvedValueOnce({ sha: HEAD, state: 'open' })
    .mockResolvedValueOnce({ sha: 'newer', state: 'open' })
  await expect(applyPrCommentCommand(event('@uselumo approve'))).resolves.toBe(
    'failed'
  )
  expect(submitReview).not.toHaveBeenCalled()
  expect(replyBody()).toContain('new commit was pushed')
})

it('an unknown PR author with author approval on ⇒ treated like any write-access commenter', async () => {
  await expect(
    applyPrCommentCommand({
      ...event('@uselumo approve'),
      prAuthorLogin: null,
    })
  ).resolves.toBe('done')
  expect(submitReview).toHaveBeenCalled()
})

it('an unknown PR author with author approval off ⇒ refused (fails closed)', async () => {
  allowAuthor.mockResolvedValue(false)
  await expect(
    applyPrCommentCommand({
      ...event('@uselumo approve'),
      prAuthorLogin: null,
    })
  ).resolves.toBe('refused_author')
  expect(submitReview).not.toHaveBeenCalled()
})

it('buildApproveReply pluralises', () => {
  expect(buildApproveReply({ kind: 'blocked', blocking: 2 }, '@x')).toMatch(
    /2 findings block DONE/
  )
  expect(
    buildApproveReply(
      {
        kind: 'approved',
        sha: HEAD,
        result: { resolved: 2, kept: 0, failed: 0 },
      },
      '@x'
    )
  ).toBe('✅ Approved `abcdef1`. Resolved 2 Lumo review threads.')
})

it('a refused thread-token mint (no Contents: write) ⇒ the LUM-1127 reply, no approval', async () => {
  ;(getRepoToken as jest.Mock).mockImplementation(
    async (_w: string, _r: string, perms: object) => {
      if (perms === REPO_TOKEN_PERMISSIONS.reviewThreadWrite)
        throw Object.assign(new Error('refused'), { status: 422 })
      return 'tok'
    }
  )
  await expect(applyPrCommentCommand(event('@uselumo approve'))).resolves.toBe(
    'failed'
  )
  expect(resolveThread).not.toHaveBeenCalled()
  expect(submitReview).not.toHaveBeenCalled()
  expect(replyBody()).toContain('Contents: Read & write')
})
