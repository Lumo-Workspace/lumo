/**
 * @jest-environment node
 *
 * LUM-1130 follow-up — every Lumo approval dismisses Lumo's own earlier
 * "changes requested" reviews on the PR, whichever path approved: the
 * automatic verdict after a passing re-check (`apply`) and `@<app> approve`
 * (`approveByCommand`).
 *
 * Production probe lumo-agent-test#61: GitHub answered the APPROVE submit
 * with 422 yet recorded the approval, so the dismissals — which only ran
 * after a resolved submit — never ran, and the change request stood next to
 * the approval. The approval is now confirmed from a fresh review listing.
 */
jest.mock('@/lib/integrations/github/pr-comment-client', () => {
  const actual = jest.requireActual(
    '@/lib/integrations/github/pr-comment-client'
  )
  return {
    GithubApiError: actual.GithubApiError,
    prCommentClient: {
      listReviews: jest.fn(),
      dismissReview: jest.fn().mockResolvedValue(undefined),
      submitReview: jest.fn(),
      getPullRequestHead: jest.fn(),
    },
  }
})
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import {
  GithubApiError,
  prCommentClient,
  type ListedReview,
} from '@/lib/integrations/github/pr-comment-client'
import { logger } from '@/lib/logger'
import {
  describeGithubFailure,
  prReviewVerdictService,
} from '@/ee/security/services/pr-review-verdict.service'
import { changeRequestsSupersededBy } from '@/ee/security/services/pr-review-verdict'

const listReviews = prCommentClient.listReviews as jest.Mock
const submitReview = prCommentClient.submitReview as jest.Mock
const dismissReview = prCommentClient.dismissReview as jest.Mock
const liveHead = prCommentClient.getPullRequestHead as jest.Mock
const warn = logger.warn as jest.Mock

const SHA = '5bfea6ddffe98adf27f05bff5cf5c321981c51b3'
const repo = { owner: 'acme', name: 'web' }
const LUMO = { login: 'uselumo[bot]', type: 'Bot' }
const HUMAN = { login: 'alice', type: 'User' }

function review(
  id: number,
  state: string,
  user = LUMO,
  commit = SHA
): ListedReview {
  return { id, state, commit_id: commit, user }
}

const changesRequested = review(101, 'CHANGES_REQUESTED')
const humanChanges = review(102, 'CHANGES_REQUESTED', HUMAN)
const approval = review(200, 'APPROVED')

/** GitHub's 422 as the probe saw it. */
const unprocessable = () =>
  new GithubApiError(422, {
    message: 'Unprocessable Entity',
    errors: ['was submitted too quickly'],
  })

const applyInput = {
  repo,
  prNumber: 61,
  token: 'tok',
  headSha: SHA,
  scan: {
    status: 'CLEAN' as const,
    partial: false,
    stages: { secrets: 'CLEAN' as const },
  },
  openThreads: 0,
  blocking: 0,
  unpostedActionable: 0,
  failingChecks: 0,
}

const commandInput = {
  repo,
  prNumber: 61,
  token: 'tok',
  login: 'cli-lumo',
  sha: SHA,
}

beforeEach(() => {
  jest.clearAllMocks()
  liveHead.mockResolvedValue({ sha: SHA, state: 'open' })
})

const dismissedIds = () => dismissReview.mock.calls.map(c => c[0].reviewId)

describe.each([
  ['automatic verdict (apply)', () => prReviewVerdictService.apply(applyInput)],
  [
    '@uselumo approve (approveByCommand)',
    () => prReviewVerdictService.approveByCommand(commandInput),
  ],
])('%s', (_name, approve) => {
  it('approves, then dismisses Lumo’s earlier change request (never a human’s)', async () => {
    listReviews
      .mockResolvedValueOnce([changesRequested, humanChanges])
      .mockResolvedValue([changesRequested, humanChanges, approval])
    submitReview.mockResolvedValue({ id: 200 })

    await approve()

    expect(submitReview.mock.calls.map(c => c[0].event)).toEqual(['APPROVE'])
    expect(dismissedIds()).toEqual([101])
  })

  it('GitHub answers the APPROVE with 422 but records it ⇒ the change request is still dismissed (probe #61)', async () => {
    listReviews
      .mockResolvedValueOnce([changesRequested])
      .mockResolvedValue([changesRequested, approval])
    submitReview.mockRejectedValue(unprocessable())

    const out = await approve()

    expect(dismissedIds()).toEqual([101])
    expect(out).toEqual(
      typeof out === 'string' ? 'approved' : { ok: true, sha: SHA }
    )
    // GitHub's reason reaches the log.
    expect(warn.mock.calls.map(c => String(c[0])).join('\n')).toContain(
      'was submitted too quickly'
    )
  })

  it('the APPROVE fails and no approval is on the PR ⇒ nothing is dismissed', async () => {
    listReviews.mockResolvedValue([changesRequested])
    submitReview.mockRejectedValue(unprocessable())

    let out: unknown
    try {
      out = await approve()
    } catch (error) {
      out = error
    }

    expect(dismissReview).not.toHaveBeenCalled()
    // apply reports 'failed'; the command path throws for its own outcome.
    expect(out === 'failed' || out instanceof GithubApiError).toBe(true)
  })

  it('a change request Lumo filed after this approval (a newer sync) is left standing', async () => {
    const later = review(300, 'CHANGES_REQUESTED')
    listReviews
      .mockResolvedValueOnce([changesRequested])
      .mockResolvedValue([changesRequested, approval, later])
    submitReview.mockResolvedValue({ id: 200 })

    await approve()

    expect(dismissedIds()).toEqual([101])
  })

  it('the confirming re-list fails after a clean submit ⇒ the change requests read before approving are dismissed', async () => {
    listReviews
      .mockResolvedValueOnce([changesRequested])
      .mockRejectedValue(new TypeError('fetch failed'))
    submitReview.mockResolvedValue({ id: 200 })

    await approve()

    expect(dismissedIds()).toEqual([101])
  })
})

describe('changeRequestsSupersededBy', () => {
  it('Lumo change requests before Lumo’s latest approval of the sha', () => {
    const older = review(90, 'CHANGES_REQUESTED', LUMO, 'old')
    expect(
      changeRequestsSupersededBy(
        [older, changesRequested, humanChanges, approval],
        SHA
      )
    ).toEqual([90, 101])
  })

  it('null when Lumo has not approved this sha', () => {
    expect(
      changeRequestsSupersededBy(
        [changesRequested, review(5, 'APPROVED', LUMO, 'other')],
        SHA
      )
    ).toBeNull()
    expect(
      changeRequestsSupersededBy([review(6, 'APPROVED', HUMAN)], SHA)
    ).toBeNull()
  })
})

describe('describeGithubFailure', () => {
  it('carries GitHub’s `errors` detail of a 422', () => {
    expect(describeGithubFailure(unprocessable())).toBe(
      'status=422 Error: Unprocessable Entity errors=was submitted too quickly'
    )
  })
})
