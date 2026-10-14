/** @jest-environment node */
import { prReviewControlService } from '@/ee/security/services/pr-review-control.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prReviewControlRepository } from '@/ee/security/repositories/pr-review-control.repository'
import { dispatchPrSecurityScan } from '@/ee/security/services/pr-security-scan-dispatch'
import { fetchPrCommitCount } from '@/lib/integrations/github/contents'
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findByNumberInWorkspace: jest.fn() },
}))
jest.mock('@/ee/security/repositories/pr-review-control.repository', () => ({
  prReviewControlRepository: { update: jest.fn(), get: jest.fn() },
}))
jest.mock('@/ee/security/repositories/security-columns.repository', () => ({
  securityColumnsRepository: {
    findReviewAutoPauseAfter: jest.fn().mockResolvedValue(5),
  },
}))
jest.mock('@/ee/security/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/integrations/github/contents', () => ({
  fetchPrCommitCount: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

beforeEach(() => {
  jest.clearAllMocks()
  ;(
    pullRequestRepository.findByNumberInWorkspace as jest.Mock
  ).mockResolvedValue([
    { id: 'pr', state: 'open', repo: 'o/r', number: 7, headSha: 'head25' },
  ])
  ;(fetchPrCommitCount as jest.Mock).mockResolvedValue(25)
})

test('a member can request a manual full review only for a PR resolved in their workspace', async () => {
  expect(
    await prReviewControlService.act('workspace', 7, 'o/r', 'full')
  ).toEqual({ queued: true, mode: 'full' })
  expect(pullRequestRepository.findByNumberInWorkspace).toHaveBeenCalledWith(
    'workspace',
    7,
    'o/r'
  )
  expect(dispatchPrSecurityScan).toHaveBeenCalledWith('pr', 'PR_EVENT', 'full')
  expect(prReviewControlRepository.update).not.toHaveBeenCalled()
})

test('resume updates the durable budget without queuing a review', async () => {
  ;(prReviewControlRepository.get as jest.Mock).mockResolvedValue({
    reviewPaused: false,
    reviewHeads: [],
    reviewHeadCommits: [],
    reviewCommitLimit: 2,
  })
  // LUM-1137: answers with the budget as the readouts show it.
  expect(
    await prReviewControlService.act('workspace', 7, 'o/r', 'resume', 2)
  ).toEqual({ paused: false, rounds: 0, limit: 2, unit: 'commits' })
  // LUM-1137: resume baselines the budget at the PR's current commit count.
  expect(fetchPrCommitCount).toHaveBeenCalledWith({
    workspaceId: 'workspace',
    fullName: 'o/r',
    prNumber: 7,
    head: 'head25',
  })
  expect(prReviewControlRepository.update).toHaveBeenCalledWith(
    'pr',
    'resume',
    2,
    25
  )
  expect(dispatchPrSecurityScan).not.toHaveBeenCalled()
})

test('LUM-1137: resume without a readable commit count stores no baseline; pause never reads it', async () => {
  ;(prReviewControlRepository.get as jest.Mock).mockResolvedValue({
    reviewPaused: false,
    reviewHeads: [],
    reviewHeadCommits: [],
    reviewCommitLimit: null,
  })
  ;(fetchPrCommitCount as jest.Mock).mockRejectedValueOnce(new Error('502'))
  await prReviewControlService.act('workspace', 7, 'o/r', 'resume')
  expect(prReviewControlRepository.update).toHaveBeenLastCalledWith(
    'pr',
    'resume',
    undefined,
    null
  )
  ;(fetchPrCommitCount as jest.Mock).mockClear()
  await prReviewControlService.act('workspace', 7, 'o/r', 'pause')
  expect(fetchPrCommitCount).not.toHaveBeenCalled()
  expect(prReviewControlRepository.update).toHaveBeenLastCalledWith(
    'pr',
    'pause',
    undefined,
    null
  )
})

test('unknown, ambiguous and closed PRs fail before mutating or dispatching', async () => {
  for (const [prs, status] of [
    [[], 404],
    [[{ id: 'a' }, { id: 'b' }], 409],
    [[{ id: 'a', state: 'closed' }], 409],
  ] as const) {
    ;(
      pullRequestRepository.findByNumberInWorkspace as jest.Mock
    ).mockResolvedValueOnce(prs)
    await expect(
      prReviewControlService.act('workspace', 7, undefined, 'full')
    ).rejects.toMatchObject({ status })
  }
  expect(dispatchPrSecurityScan).not.toHaveBeenCalled()
  await expect(
    prReviewControlService.act('workspace', 7, 'o/r', 'full', 2)
  ).rejects.toMatchObject({ status: 400 })
})
