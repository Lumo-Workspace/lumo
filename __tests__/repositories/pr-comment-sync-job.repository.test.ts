import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    prCommentSyncJob: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

describe('prCommentSyncJobRepository', () => {
  beforeEach(() => jest.clearAllMocks())

  it('enqueue inserts a PENDING row with scheduledFor=now by default', async () => {
    await prCommentSyncJobRepository.enqueue({
      direction: 'OUTBOUND',
      payload: { op: 'CREATE' },
      commentId: 'c1',
      workspaceId: 'w1',
    })
    expect(prisma.prCommentSyncJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'OUTBOUND',
        payload: { op: 'CREATE' },
        commentId: 'c1',
        workspaceId: 'w1',
        status: 'PENDING',
      }),
    })
  })

  it('findDue returns PENDING jobs whose scheduledFor <= now, capped at limit', async () => {
    await prCommentSyncJobRepository.findDue({ limit: 50 })
    expect(prisma.prCommentSyncJob.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', scheduledFor: { lte: expect.any(Date) } },
      orderBy: { scheduledFor: 'asc' },
      take: 50,
    })
  })

  it('recordFailure increments attempts and sets backoff (1m, 5m, 15m)', async () => {
    await prCommentSyncJobRepository.recordFailure('j1', 1, 'err')
    expect(prisma.prCommentSyncJob.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: {
        attempts: 2,
        lastError: 'err',
        scheduledFor: expect.any(Date),
      },
    })
    const arg = (prisma.prCommentSyncJob.update as jest.Mock).mock.calls[0][0]
    const delay = arg.data.scheduledFor.getTime() - Date.now()
    expect(delay).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1000)
    expect(delay).toBeLessThanOrEqual(5 * 60 * 1000 + 1000)
  })

  it('rescheduleAt sets scheduledFor without consuming an attempt', async () => {
    const at = new Date('2027-01-01T00:00:00Z')
    await prCommentSyncJobRepository.rescheduleAt('j1', at, 'rate-limit')
    expect(prisma.prCommentSyncJob.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: { scheduledFor: at, lastError: 'rate-limit' },
    })
  })

  it('markDeadLetter flips status', async () => {
    await prCommentSyncJobRepository.markDeadLetter('j1', 'final error')
    expect(prisma.prCommentSyncJob.update).toHaveBeenCalledWith({
      where: { id: 'j1' },
      data: {
        status: 'DEAD_LETTER',
        lastError: 'final error',
        deadLetteredAt: expect.any(Date),
      },
    })
  })

  it('findDueByTask filters by commentId.taskId joined and limit', async () => {
    await prCommentSyncJobRepository.findDueByTask('t1', { limit: 10 })
    expect(prisma.prCommentSyncJob.findMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING',
        scheduledFor: { lte: expect.any(Date) },
        direction: 'OUTBOUND',
        comment: { taskId: 't1' },
      },
      orderBy: { scheduledFor: 'asc' },
      take: 10,
    })
  })

  it('findDueByPullRequest filters by inbound payload.pullRequestId', async () => {
    await prCommentSyncJobRepository.findDueByPullRequest('pr1', { limit: 10 })
    expect(prisma.prCommentSyncJob.findMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING',
        scheduledFor: { lte: expect.any(Date) },
        direction: 'INBOUND',
        payload: { path: ['pullRequestId'], equals: 'pr1' },
      },
      orderBy: { scheduledFor: 'asc' },
      take: 10,
    })
  })
})
