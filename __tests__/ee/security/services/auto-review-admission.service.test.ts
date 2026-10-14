/**
 * @jest-environment node
 *
 * LUM-1137 — every push is admitted to automatic AI review until N reviewed
 * commits, under an hourly cap per PR author: over the cap a head is
 * rate-limited (not reserved, not paused), and the next push after the
 * window is reviewed.
 */
jest.mock('@/ee/security/repositories/pr-review-control.repository', () => ({
  prReviewControlRepository: { get: jest.fn(), reserve: jest.fn() },
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: { findReviewAutoPauseAfter: jest.fn() },
}))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrCommitCount: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import {
  AUTO_REVIEW_HOURLY_CAP,
  __resetAutoReviewRateLimitForTests,
  autoReviewAdmissionService,
} from '@/ee/security/services/auto-review-admission.service'
import { prReviewControlRepository } from '@/ee/security/repositories/pr-review-control.repository'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import { fetchPrCommitCount } from '@/lib/integrations/github/contents'

const get = prReviewControlRepository.get as jest.Mock
const reserve = prReviewControlRepository.reserve as jest.Mock
const workspaceLimit =
  securityColumnsRepository.findReviewAutoPauseAfter as jest.Mock
const commitCount = fetchPrCommitCount as jest.Mock

const pr = {
  id: 'pr1',
  workspaceId: 'ws',
  repo: 'o/r',
  number: 7,
  authorLogin: 'Dev',
}
const fresh = {
  reviewPaused: false,
  reviewHeads: [] as string[],
  reviewHeadCommits: [] as number[],
  reviewCommitLimit: null,
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date('2026-10-15T10:00:00Z'))
  jest.clearAllMocks()
  __resetAutoReviewRateLimitForTests()
  get.mockResolvedValue(fresh)
  workspaceLimit.mockResolvedValue(5)
  reserve.mockResolvedValue(true)
  commitCount.mockResolvedValue(3)
})
afterEach(() => jest.useRealTimers())

test('a new head is reserved with its commit count under the workspace limit', async () => {
  expect(await autoReviewAdmissionService.admit(pr, 'h1')).toEqual({
    allowed: true,
    rateLimited: false,
  })
  expect(commitCount).toHaveBeenCalledWith({
    workspaceId: 'ws',
    fullName: 'o/r',
    prNumber: 7,
    head: 'h1',
  })
  expect(reserve).toHaveBeenCalledWith('pr1', 'h1', {
    commitsAtHead: 3,
    workspaceLimit: 5,
  })
})

test('an unreadable commit count still admits the head (counts as one commit)', async () => {
  commitCount.mockRejectedValue(new Error('GitHub 502'))
  expect((await autoReviewAdmissionService.admit(pr, 'h1')).allowed).toBe(true)
  expect(reserve).toHaveBeenCalledWith('pr1', 'h1', {
    commitsAtHead: null,
    workspaceLimit: 5,
  })
})

test('a PR at its reviewed-commit limit is paused — not rate-limited, and the cap is not spent', async () => {
  get.mockResolvedValue({
    ...fresh,
    reviewHeads: ['a', 'b'],
    reviewHeadCommits: [3, 5],
  })
  expect(await autoReviewAdmissionService.admit(pr, 'c')).toEqual({
    allowed: false,
    rateLimited: false,
  })
  expect(reserve).not.toHaveBeenCalled()
})

test('rate cap reached ⇒ rate-limited and not reserved; the next push after the window is reviewed', async () => {
  for (let i = 0; i < AUTO_REVIEW_HOURLY_CAP.max; i++)
    expect(
      (await autoReviewAdmissionService.admit({ ...pr, id: `p${i}` }, `h${i}`))
        .allowed
    ).toBe(true)
  reserve.mockClear()
  // Same author (case-insensitive), another PR in the workspace.
  expect(
    await autoReviewAdmissionService.admit(
      { ...pr, id: 'next', authorLogin: 'dev' },
      'over'
    )
  ).toEqual({ allowed: false, rateLimited: true })
  expect(reserve).not.toHaveBeenCalled()
  // Another author is not limited by Dev's pushes.
  expect(
    (
      await autoReviewAdmissionService.admit(
        { ...pr, id: 'other', authorLogin: 'someone-else' },
        'o1'
      )
    ).allowed
  ).toBe(true)
  // An hour later the next push is reviewed.
  jest.setSystemTime(Date.now() + AUTO_REVIEW_HOURLY_CAP.windowMs + 1)
  expect(
    await autoReviewAdmissionService.admit({ ...pr, id: 'next' }, 'later')
  ).toEqual({ allowed: true, rateLimited: false })
})

test('retrying an admitted head never counts against the hourly cap', async () => {
  get.mockResolvedValue({
    ...fresh,
    reviewHeads: ['h1'],
    reviewHeadCommits: [1],
  })
  for (let i = 0; i < AUTO_REVIEW_HOURLY_CAP.max + 5; i++)
    expect((await autoReviewAdmissionService.admit(pr, 'h1')).allowed).toBe(
      true
    )
  expect(commitCount).not.toHaveBeenCalled()
})

test('N=0 (never pause) admits a PR with many reviewed commits', async () => {
  workspaceLimit.mockResolvedValue(0)
  get.mockResolvedValue({
    ...fresh,
    reviewHeads: ['a'],
    reviewHeadCommits: [40],
  })
  expect((await autoReviewAdmissionService.admit(pr, 'b')).allowed).toBe(true)
})
