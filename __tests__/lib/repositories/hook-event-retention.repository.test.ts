jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    hookEvent: { findMany: jest.fn(), updateMany: jest.fn() },
    boundaryCrossing: { findMany: jest.fn() },
    task: { findMany: jest.fn() },
    workspace: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { hookEventRetentionRepository as repo } from '@/lib/repositories/hook-event-retention.repository'

const findMany = prisma.hookEvent.findMany as jest.Mock
const updateMany = prisma.hookEvent.updateMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('hookEventRetentionRepository (LUM-859)', () => {
  it('queries expired unpruned events whose own or session task is not open', async () => {
    findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }])
    const before = new Date('2026-06-01T00:00:00Z')
    const ids = await repo.findExpiredEventIds({
      workspaceId: 'ws',
      before,
      openTaskIds: ['t_open'],
      afterId: 'e0',
      take: 500,
    })
    expect(ids).toEqual(['e1', 'e2'])
    expect(findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws',
        payloadPrunedAt: null,
        createdAt: { lt: before },
        id: { gt: 'e0' },
        OR: [
          { taskId: { notIn: ['t_open'] } },
          { taskId: null, sessionId: null },
          {
            taskId: null,
            session: {
              is: {
                OR: [{ taskId: null }, { taskId: { notIn: ['t_open'] } }],
              },
            },
          },
        ],
      },
      orderBy: { id: 'asc' },
      take: 500,
      select: { id: true },
    })
  })

  it('only overwrites rows that are not pruned yet', async () => {
    updateMany.mockResolvedValue({ count: 1 })
    const at = new Date('2026-09-27T00:00:00Z')
    const marker = { _lumo_pruned: { at: at.toISOString() } }
    await expect(repo.prunePayloads(['e1', 'e2'], marker, at)).resolves.toBe(1)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['e1', 'e2'] }, payloadPrunedAt: null },
      data: { payload: marker, payloadEncrypted: null, payloadPrunedAt: at },
    })
    await expect(repo.prunePayloads([], marker, at)).resolves.toBe(0)
    expect(updateMany).toHaveBeenCalledTimes(1)
  })

  it('scopes open tasks to the workspace and excludes DONE', async () => {
    ;(prisma.task.findMany as jest.Mock).mockResolvedValue([{ id: 't1' }])
    await expect(repo.findOpenTaskIds('ws')).resolves.toEqual(['t1'])
    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: { team: { workspaceId: 'ws' }, status: { not: 'DONE' } },
      select: { id: true },
    })
  })
})
