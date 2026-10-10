/** @jest-environment node */
import { prisma } from '@/lib/db/prisma'
import { prReviewControlRepository } from '@/lib/repositories/pr-review-control.repository'
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    pullRequest: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    prSecurityScan: { findFirst: jest.fn() },
    prSecurityFinding: { findMany: jest.fn() },
  },
}))

test('reservations are serializable and concurrent heads cannot admit more than two rounds', async () => {
  const control = {
    reviewPaused: false,
    reviewRoundLimit: 2,
    reviewHeads: [] as string[],
  }
  const read = prisma.pullRequest.findUniqueOrThrow as jest.Mock
  const write = prisma.pullRequest.update as jest.Mock
  read.mockImplementation(async () => ({
    ...control,
    reviewHeads: [...control.reviewHeads],
  }))
  write.mockImplementation(async ({ data }) => {
    control.reviewHeads.push(data.reviewHeads.push)
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
      prReviewControlRepository.reserve('pr', head)
    )
  )
  expect(admitted.filter(Boolean)).toHaveLength(2)
  expect(control.reviewHeads).toEqual(['a', 'b'])
  expect(await prReviewControlRepository.reserve('pr', 'a')).toBe(true)
  expect(control.reviewHeads).toHaveLength(2)
})

test('serialization conflicts re-read current state; pause denies even a previously admitted head', async () => {
  const tx = prisma.$transaction as jest.Mock
  tx.mockRejectedValueOnce(
    Object.assign(new Error('conflict'), { code: 'P2034' })
  ).mockImplementationOnce(fn => fn(prisma))
  ;(prisma.pullRequest.findUniqueOrThrow as jest.Mock).mockResolvedValueOnce({
    reviewPaused: true,
    reviewRoundLimit: 2,
    reviewHeads: ['a'],
  })
  expect(await prReviewControlRepository.reserve('pr', 'a')).toBe(false)
})

test('resume clears reservations and applies the configured limit; reads return persisted control', async () => {
  const write = prisma.pullRequest.update as jest.Mock
  write.mockResolvedValueOnce({})
  await prReviewControlRepository.update('pr', 'resume', 3)
  expect(write).toHaveBeenLastCalledWith({
    where: { id: 'pr' },
    data: { reviewPaused: false, reviewHeads: [], reviewRoundLimit: 3 },
  })
  ;(prisma.pullRequest.findUniqueOrThrow as jest.Mock).mockResolvedValueOnce({
    reviewPaused: false,
    reviewRoundLimit: 3,
    reviewHeads: [],
  })
  expect(await prReviewControlRepository.get('pr')).toMatchObject({
    reviewRoundLimit: 3,
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
