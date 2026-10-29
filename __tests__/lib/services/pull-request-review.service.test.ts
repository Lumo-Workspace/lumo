/**
 * LUM-1334: `pull_request_review` webhooks → stored reviews for the DONE
 * gate's review requirement. Only human approvals, change requests and
 * dismissals are kept.
 */
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findByRepoAndNumber: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request-review.repository', () => ({
  pullRequestReviewRepository: {
    upsert: jest.fn(async () => ({ id: 'r' })),
    createIfAbsent: jest.fn(async () => ({ id: 'r' })),
    updateUnlessState: jest.fn(async () => undefined),
  },
}))

import {
  parseReviewPayload,
  pullRequestReviewService,
} from '@/lib/services/pull-request-review.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { pullRequestReviewRepository } from '@/lib/repositories/pull-request-review.repository'

const findPr = pullRequestRepository.findByRepoAndNumber as jest.Mock
const upsert = pullRequestReviewRepository.upsert as jest.Mock
const createIfAbsent = pullRequestReviewRepository.createIfAbsent as jest.Mock
const updateUnlessState =
  pullRequestReviewRepository.updateUnlessState as jest.Mock

function payload(review: Record<string, unknown> = {}) {
  return {
    action: 'submitted',
    review: {
      id: 987,
      state: 'approved',
      commit_id: 'a'.repeat(40),
      submitted_at: '2026-10-28T10:00:00Z',
      user: { login: 'alice', type: 'User' },
      author_association: 'MEMBER',
      ...review,
    },
    pull_request: { number: 12 },
    repository: { full_name: 'o/r' },
  }
}

beforeEach(() => jest.clearAllMocks())

describe('parseReviewPayload', () => {
  it('reads an approval', () => {
    expect(parseReviewPayload(payload())).toEqual({
      repo: 'o/r',
      prNumber: 12,
      githubReviewId: '987',
      reviewerLogin: 'alice',
      state: 'APPROVED',
      commitSha: 'a'.repeat(40),
      submittedAt: new Date('2026-10-28T10:00:00Z'),
    })
  })

  it('keeps change requests and dismissals', () => {
    expect(
      parseReviewPayload(payload({ state: 'changes_requested' }))?.state
    ).toBe('CHANGES_REQUESTED')
    expect(parseReviewPayload(payload({ state: 'DISMISSED' }))?.state).toBe(
      'DISMISSED'
    )
  })

  it('counts an approval only from the repo owner, a collaborator or an org member', () => {
    for (const a of ['OWNER', 'collaborator', 'MEMBER'])
      expect(
        parseReviewPayload(payload({ author_association: a }))?.state
      ).toBe('APPROVED')
    for (const a of [
      'CONTRIBUTOR',
      'FIRST_TIME_CONTRIBUTOR',
      'NONE',
      undefined,
    ])
      expect(parseReviewPayload(payload({ author_association: a }))).toBeNull()
    // A change request from outside still withdraws nothing it could grant.
    expect(
      parseReviewPayload(
        payload({ state: 'changes_requested', author_association: 'NONE' })
      )?.state
    ).toBe('CHANGES_REQUESTED')
  })

  it('skips comments, bots and malformed payloads', () => {
    expect(parseReviewPayload(payload({ state: 'commented' }))).toBeNull()
    expect(
      parseReviewPayload(payload({ user: { login: 'ci[bot]', type: 'Bot' } }))
    ).toBeNull()
    expect(parseReviewPayload(payload({ commit_id: '' }))).toBeNull()
    expect(parseReviewPayload(payload({ submitted_at: 'nope' }))).toBeNull()
    expect(parseReviewPayload({ review: {} })).toBeNull()
  })
})

describe('pullRequestReviewService.record', () => {
  const review = {
    pullRequestId: 'pr-1',
    githubReviewId: '987',
    reviewerLogin: 'alice',
    commitSha: 'a'.repeat(40),
    submittedAt: new Date('2026-10-28T10:00:00Z'),
  }

  it('a dismissal overwrites whatever is stored', async () => {
    await pullRequestReviewService.record({ ...review, state: 'DISMISSED' })
    expect(upsert).toHaveBeenCalledWith({ ...review, state: 'DISMISSED' })
    expect(createIfAbsent).not.toHaveBeenCalled()
    expect(updateUnlessState).not.toHaveBeenCalled()
  })

  it('any other state never overwrites a stored dismissal', async () => {
    const approved = { ...review, state: 'APPROVED' as const }
    await pullRequestReviewService.record(approved)
    expect(createIfAbsent).toHaveBeenCalledWith(approved)
    expect(updateUnlessState).toHaveBeenCalledWith(approved, 'DISMISSED')
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('pullRequestReviewService.recordFromWebhook', () => {
  it("stores the review on the workspace's PR row", async () => {
    findPr.mockResolvedValue({ id: 'pr-1' })
    expect(
      await pullRequestReviewService.recordFromWebhook(payload(), 'w-1')
    ).toBe(true)
    expect(findPr).toHaveBeenCalledWith('w-1', 'o/r', 12)
    expect(createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequestId: 'pr-1',
        githubReviewId: '987',
        state: 'APPROVED',
      })
    )
  })

  it('does nothing for an unknown PR or a skipped review', async () => {
    findPr.mockResolvedValue(null)
    expect(
      await pullRequestReviewService.recordFromWebhook(payload(), 'w-1')
    ).toBe(false)
    expect(
      await pullRequestReviewService.recordFromWebhook(
        payload({ state: 'commented' }),
        'w-1'
      )
    ).toBe(false)
    expect(createIfAbsent).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })
})
