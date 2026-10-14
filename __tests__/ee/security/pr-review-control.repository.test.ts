/** @jest-environment node */
import { prisma } from '@/lib/db/prisma'
import { prReviewControlRepository } from '@/ee/security/repositories/pr-review-control.repository'
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    pullRequest: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    prSecurityScan: { findFirst: jest.fn() },
    prSecurityFinding: { findMany: jest.fn() },
  },
}))

const limit2 = { commitsAtHead: null, workspaceLimit: 2 }

test('reservations are serializable and concurrent heads cannot admit more than two commits', async () => {
  const control = {
    reviewPaused: false,
    reviewCommitLimit: null,
    reviewHeads: [] as string[],
    reviewHeadCommits: [] as number[],
  }
  const read = prisma.pullRequest.findUniqueOrThrow as jest.Mock
  const write = prisma.pullRequest.update as jest.Mock
  read.mockImplementation(async () => ({
    ...control,
    reviewHeads: [...control.reviewHeads],
  }))
  write.mockImplementation(async ({ data }) => {
    control.reviewHeads.push(data.reviewHeads.push)
    control.reviewHeadCommits = data.reviewHeadCommits
  })
  let tail = Promise.resolve()
  const tx = prisma.$transaction as jest.Mock
  // Model the DB's serial execution; assert the production call requests it.
  tx.mockImplementation((fn, options) => {
    expect(options.isolationLevel).toBe('Serializable')
    const result = tail.then(() => fn(prisma))
    tail = result.then(() => undefined)
    return result
  })
  const admitted = await Promise.all(
    ['a', 'b', 'c', 'd'].map(head =>
      prReviewControlRepository.reserve('pr', head, limit2)
    )
  )
  expect(admitted.filter(a => a.allowed)).toHaveLength(2)
  expect(admitted.filter(a => a.reserved)).toHaveLength(2)
  expect(control.reviewHeads).toEqual(['a', 'b'])
  // A retry of an admitted head is allowed without a new reservation.
  expect(await prReviewControlRepository.reserve('pr', 'a', limit2)).toEqual({
    allowed: true,
    reserved: false,
  })
  expect(control.reviewHeads).toHaveLength(2)
  expect(control.reviewHeadCommits).toEqual([0, 0])
})

test('serialization conflicts re-read current state; pause denies even a previously admitted head', async () => {
  const tx = prisma.$transaction as jest.Mock
  tx.mockRejectedValueOnce(
    Object.assign(new Error('conflict'), { code: 'P2034' })
  ).mockImplementationOnce(fn => fn(prisma))
  ;(prisma.pullRequest.findUniqueOrThrow as jest.Mock).mockResolvedValueOnce({
    reviewPaused: true,
    reviewCommitLimit: null,
    reviewHeads: ['a'],
    reviewHeadCommits: [1],
  })
  expect(
    (await prReviewControlRepository.reserve('pr', 'a', limit2)).allowed
  ).toBe(false)
})

test('resume clears reservations and applies the configured limit; reads return persisted control', async () => {
  const write = prisma.pullRequest.update as jest.Mock
  write.mockResolvedValueOnce({})
  await prReviewControlRepository.update('pr', 'resume', 3)
  expect(write).toHaveBeenLastCalledWith({
    where: { id: 'pr' },
    data: {
      reviewPaused: false,
      reviewHeads: [],
      reviewHeadCommits: [],
      reviewCommitLimit: 3,
    },
  })
  // LUM-1137: with the PR's commit count at resume, a baseline entry.
  write.mockResolvedValueOnce({})
  await prReviewControlRepository.update('pr', 'resume', undefined, 25)
  expect(write).toHaveBeenLastCalledWith({
    where: { id: 'pr' },
    data: {
      reviewPaused: false,
      reviewHeads: ['resume-baseline'],
      reviewHeadCommits: [25],
    },
  })
  ;(prisma.pullRequest.findUniqueOrThrow as jest.Mock).mockResolvedValueOnce({
    reviewPaused: false,
    reviewCommitLimit: 3,
    reviewHeads: [],
    reviewHeadCommits: [],
  })
  expect(await prReviewControlRepository.get('pr')).toMatchObject({
    reviewCommitLimit: 3,
  })
})

test('baseline excludes partial, failed and pending-verifier reviews; prior unverified findings are retained', async () => {
  const scan = prisma.prSecurityScan.findFirst as jest.Mock
  scan.mockResolvedValueOnce({ headSha: 'good' })
  expect(await prReviewControlRepository.baseline('pr', 'current')).toEqual({
    headSha: 'good',
  })
  expect(scan).toHaveBeenLastCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        partial: false,
        truncated: false,
        judgeStatus: 'RAN',
        OR: [{ verifierStartedAt: null }, { verifiedAt: { not: null } }],
      }),
    })
  )
  scan.mockResolvedValueOnce({ findings: [{ fingerprint: 'old' }] })
  expect(
    await prReviewControlRepository.priorFindings('pr', 'current')
  ).toEqual([{ fingerprint: 'old' }])
})
