/** @jest-environment node */
import { prReviewControlService } from '@/lib/services/pr-review-control.service'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prReviewControlRepository } from '@/lib/repositories/pr-review-control.repository'
import { dispatchPrSecurityScan } from '@/lib/services/pr-security-scan-dispatch'
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findByNumberInWorkspace: jest.fn() },
}))
jest.mock('@/lib/repositories/pr-review-control.repository', () => ({
  prReviewControlRepository: { update: jest.fn(), get: jest.fn() },
}))
jest.mock('@/lib/services/pr-security-scan-dispatch', () => ({
  dispatchPrSecurityScan: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))

beforeEach(() => {
  jest.clearAllMocks()
  ;(
    pullRequestRepository.findByNumberInWorkspace as jest.Mock
  ).mockResolvedValue([{ id: 'pr', state: 'open' }])
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
  await prReviewControlService.act('workspace', 7, 'o/r', 'resume', 2)
  expect(prReviewControlRepository.update).toHaveBeenCalledWith(
    'pr',
    'resume',
    2
  )
  expect(dispatchPrSecurityScan).not.toHaveBeenCalled()
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
