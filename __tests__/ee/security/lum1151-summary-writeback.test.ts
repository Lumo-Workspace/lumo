/**
 * @jest-environment node
 *
 * LUM-1151 — the review write-back: with the default setting the review's
 * summary goes into the PR description (the comment points there); a push
 * (the next review) updates Lumo's block only; `off` and `comment` leave
 * the description untouched; a failed edit falls back to the comment. The
 * summary comment carries the changed-files walkthrough.
 */
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      createIssueComment: jest.fn(),
      updateIssueComment: jest.fn(),
      createReview: jest.fn(),
      listIssueComments: jest.fn(),
      listReviewComments: jest.fn(),
      getPullRequestBody: jest.fn(),
      updatePullRequestBody: jest.fn(),
      listPullRequestFiles: jest.fn(),
    },
  }
})
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoToken: jest.fn(),
}))
jest.mock('@/ee/security/repositories/pr-security-scan.repository', () => ({
  prSecurityScanRepository: {
    findByIdForReview: jest.fn(),
    hasNewerScanThan: jest.fn().mockResolvedValue(false),
    findSummaryCommentIdByPullRequest: jest.fn().mockResolvedValue(null),
    isPullRequestHeldElsewhere: jest.fn().mockResolvedValue(false),
    setSummaryCommentId: jest.fn().mockResolvedValue(undefined),
  },
}))
jest.mock('@/ee/security/services/security-workspace-switches.service', () => ({
  loadSecurityLayers: jest.fn().mockResolvedValue({ scan: true }),
}))
// The request-changes workflow is off: nothing to withdraw on an open PR.
jest.mock('@/ee/security/services/request-changes-off.service', () => ({
  requestChangesOffService: {
    withdrawOnPullRequest: jest.fn().mockResolvedValue(undefined),
  },
}))
// No thread rows: the inline-thread lifecycle has nothing to reconcile.
jest.mock('@/ee/security/repositories/pr-finding-thread.repository', () => ({
  prFindingThreadRepository: {
    findByPullRequest: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import {
  buildSummary,
  clearChangedFilesCache,
  securityPrReviewService,
} from '@/ee/security/services/security-pr-review.service'
import {
  DESCRIPTION_SUMMARY_END,
  DESCRIPTION_SUMMARY_START,
} from '@/ee/security/security-scan/pr-description-summary'
import {
  GithubApiError,
  prCommentClient,
} from '@/lib/integrations/github/pr-comment-client'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'

const findById = prSecurityScanRepository.findByIdForReview as jest.Mock
const createIssue = prCommentClient.createIssueComment as jest.Mock
const getBody = prCommentClient.getPullRequestBody as jest.Mock
const updateBody = prCommentClient.updatePullRequestBody as jest.Mock
const listFiles = prCommentClient.listPullRequestFiles as jest.Mock

const SHA1 = 'abcdef1234567890abcdef1234567890abcdef12'
const SHA2 = '1234567abcdef1234567890abcdef1234567890a'
const OLD_SLUG = process.env.GITHUB_APP_SLUG

function scanRow(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    headSha: SHA1,
    status: 'CLEAN',
    stages: { secrets: 'RAN', judge: 'RAN' },
    partial: false,
    error: null,
    suggestedAt: new Date(0),
    verifierStartedAt: new Date(0),
    verifiedAt: new Date(0),
    findings: [],
    prSummary: {
      intent: 'Adds a retry to the webhook sender.',
      changes: ['Retries failed sends three times'],
    },
    pullRequest: {
      repo: 'acme/app',
      number: 9,
      state: 'open',
      workspaceId: 'w1',
      task: null,
      workspace: { slug: 'acme' },
    },
    ...over,
  }
}

function commentBody(): string {
  return createIssue.mock.calls[0]![0].body as string
}

function writtenBody(i = 0): string {
  return updateBody.mock.calls[i]![0].body as string
}

beforeEach(() => {
  jest.clearAllMocks()
  clearChangedFilesCache()
  process.env.GITHUB_APP_SLUG = 'uselumo'
  ;(getRepoToken as jest.Mock).mockResolvedValue('tok')
  ;(prCommentClient.listIssueComments as jest.Mock).mockResolvedValue([])
  ;(prCommentClient.listReviewComments as jest.Mock).mockResolvedValue([])
  createIssue.mockResolvedValue({ id: 1 })
  ;(prCommentClient.updateIssueComment as jest.Mock).mockResolvedValue({
    id: 1,
  })
  getBody.mockResolvedValue({
    body: 'Why: retries.\n\n@uselumo summary\n\nCloses #4',
    state: 'open',
  })
  updateBody.mockResolvedValue(undefined)
  listFiles.mockResolvedValue([
    {
      filename: 'src/sender.ts',
      status: 'modified',
      additions: 12,
      deletions: 3,
    },
    {
      filename: 'src/new-name.ts',
      status: 'renamed',
      additions: 0,
      deletions: 0,
      previous_filename: 'src/old-name.ts',
    },
  ])
})

afterAll(() => {
  if (OLD_SLUG === undefined) delete process.env.GITHUB_APP_SLUG
  else process.env.GITHUB_APP_SLUG = OLD_SLUG
})

describe('LUM-1151 high-level summary on the write-back', () => {
  it('default (a row from before the column): replaces the placeholder; the comment points there', async () => {
    findById.mockResolvedValue(scanRow())
    await securityPrReviewService.syncReview('s1')
    expect(updateBody).toHaveBeenCalledTimes(1)
    const body = writtenBody()
    expect(body.startsWith('Why: retries.\n\n')).toBe(true)
    expect(body.endsWith('\n\nCloses #4')).toBe(true)
    expect(body).toContain('Adds a retry to the webhook sender.')
    expect(body).not.toContain('@uselumo summary')
    expect(commentBody()).toContain('in the PR description')
    expect(commentBody()).not.toContain('Adds a retry to the webhook sender.')
  })

  it('a push: the next review updates the block in place, author text untouched', async () => {
    findById.mockResolvedValue(scanRow())
    await securityPrReviewService.syncReview('s1')
    const first = writtenBody()
    // The author edited the description between the two reviews.
    getBody.mockResolvedValue({
      body: first.replace('Closes #4', 'Closes #4 and #5'),
      state: 'open',
    })
    findById.mockResolvedValue(
      scanRow({
        id: 's2',
        headSha: SHA2,
        prSummary: { intent: 'Adds retries and logs them.', changes: [] },
        pullRequest: { ...scanRow().pullRequest, headSha: SHA2 },
      })
    )
    await securityPrReviewService.syncReview('s2')
    const second = writtenBody(1)
    expect(second.startsWith('Why: retries.\n\n')).toBe(true)
    expect(second.endsWith('\n\nCloses #4 and #5')).toBe(true)
    expect(second).toContain('Adds retries and logs them.')
    expect(second).toContain('1234567')
    expect(second).not.toContain('Adds a retry to the webhook sender.')
    expect(second.split(DESCRIPTION_SUMMARY_START)).toHaveLength(2)
    expect(second.split(DESCRIPTION_SUMMARY_END)).toHaveLength(2)
  })

  it('off: the description is untouched and nothing is summarised', async () => {
    findById.mockResolvedValue(scanRow({ highLevelSummary: 'off' }))
    await securityPrReviewService.syncReview('s1')
    expect(getBody).not.toHaveBeenCalled()
    expect(updateBody).not.toHaveBeenCalled()
    expect(commentBody()).not.toContain('Adds a retry to the webhook sender.')
    expect(commentBody()).not.toContain('in the PR description')
  })

  it('comment: the description is untouched; the summary stays in the comment', async () => {
    findById.mockResolvedValue(scanRow({ highLevelSummary: 'comment' }))
    await securityPrReviewService.syncReview('s1')
    expect(getBody).not.toHaveBeenCalled()
    expect(updateBody).not.toHaveBeenCalled()
    expect(commentBody()).toContain('Adds a retry to the webhook sender.')
  })

  it('a failed edit keeps the summary in the comment and the review still posts', async () => {
    findById.mockResolvedValue(scanRow())
    updateBody.mockRejectedValue(new GithubApiError(403, { message: 'no' }))
    const result = await securityPrReviewService.syncReview('s1')
    expect(result.posted).toBe(true)
    expect(commentBody()).toContain('Adds a retry to the webhook sender.')
  })

  it('a closed PR: the description is not edited', async () => {
    findById.mockResolvedValue(
      scanRow({ pullRequest: { ...scanRow().pullRequest, state: 'closed' } })
    )
    await securityPrReviewService.syncReview('s1')
    expect(updateBody).not.toHaveBeenCalled()
  })

  it('the comment carries the changed-files walkthrough', async () => {
    findById.mockResolvedValue(scanRow())
    await securityPrReviewService.syncReview('s1')
    const body = commentBody()
    expect(body).toContain('<summary>Walkthrough</summary>')
    expect(body).toContain('| `src/sender.ts` | modified | +12 / −3 |')
    expect(body).toContain(
      '| `src/new-name.ts` (from `src/old-name.ts`) | renamed | +0 / −0 |'
    )
    expect(body).toContain('2 files changed, +12 / −3 lines.')
  })

  it('no walkthrough when GitHub does not list the files', async () => {
    findById.mockResolvedValue(scanRow())
    listFiles.mockRejectedValue(new Error('boom'))
    const result = await securityPrReviewService.syncReview('s1')
    expect(result.posted).toBe(true)
    expect(commentBody()).not.toContain('Walkthrough')
  })
})

describe('LUM-1151 ruling — whole-PR summary and walkthrough on an incremental review', () => {
  it('the walkthrough lists every file of the PR, not the incremental slice', async () => {
    findById.mockResolvedValue(scanRow({ judgeReviewScope: ['src/sender.ts'] }))
    await securityPrReviewService.syncReview('s1')
    expect(listFiles).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 9 })
    )
    expect(commentBody()).toContain('`src/new-name.ts`')
  })

  it('a kept earlier summary says which commit it describes, in the description and the comment', async () => {
    findById.mockResolvedValue(
      scanRow({
        highLevelSummary: 'comment',
        prSummary: {
          intent: 'Adds a retry to the webhook sender.',
          changes: [],
          describesSha: SHA2,
        },
      })
    )
    await securityPrReviewService.syncReview('s1')
    expect(commentBody()).toContain('1234567')
    expect(commentBody()).toMatch(/could not refresh it for `abcdef1`/)

    jest.clearAllMocks()
    createIssue.mockResolvedValue({ id: 1 })
    getBody.mockResolvedValue({ body: 'Text', state: 'open' })
    ;(getRepoToken as jest.Mock).mockResolvedValue('tok')
    ;(prCommentClient.listIssueComments as jest.Mock).mockResolvedValue([])
    ;(prCommentClient.listReviewComments as jest.Mock).mockResolvedValue([])
    findById.mockResolvedValue(
      scanRow({
        prSummary: {
          intent: 'Adds a retry to the webhook sender.',
          changes: [],
          describesSha: SHA2,
        },
      })
    )
    await securityPrReviewService.syncReview('s1')
    expect(writtenBody()).toContain('1234567')
    expect(writtenBody()).toMatch(/could not refresh it for abcdef1/)
  })
})

describe('LUM-1151 — the PR file list is read once per head', () => {
  it('later syncs of the same head reuse it; a new head reads it again', async () => {
    clearChangedFilesCache()
    findById.mockResolvedValue(scanRow())
    await securityPrReviewService.syncReview('s1')
    await securityPrReviewService.syncReview('s1')
    expect(listFiles).toHaveBeenCalledTimes(1)
    expect(createIssue.mock.calls[0]![0].body).toContain('`src/sender.ts`')
    findById.mockResolvedValue(
      scanRow({
        id: 's2',
        headSha: SHA2,
        pullRequest: { ...scanRow().pullRequest, headSha: SHA2 },
      })
    )
    await securityPrReviewService.syncReview('s2')
    expect(listFiles).toHaveBeenCalledTimes(2)
  })

  it('a failed read is not kept: the next sync tries again', async () => {
    clearChangedFilesCache()
    findById.mockResolvedValue(scanRow())
    listFiles.mockRejectedValueOnce(new Error('boom'))
    await securityPrReviewService.syncReview('s1')
    await securityPrReviewService.syncReview('s1')
    expect(listFiles).toHaveBeenCalledTimes(2)
  })
})

describe('buildSummary — callers that do not say keep the summary in the comment', () => {
  it('defaults to the comment (as before LUM-1151)', () => {
    const body = buildSummary({
      headSha: SHA1,
      stages: { secrets: 'RAN' },
      partial: false,
      externalCounts: {},
      open: 0,
      blocking: 0,
      error: null,
      taskUrl: null,
      prSummary: { intent: 'Does a thing.', changes: [] },
    })
    expect(body).toContain('Does a thing.')
    expect(body).not.toContain('Walkthrough')
  })
})
