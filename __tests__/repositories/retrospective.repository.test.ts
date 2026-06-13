/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskForecastSnapshot: { findUnique: jest.fn(), create: jest.fn() },
    task: { findUnique: jest.fn(), count: jest.fn() },
    notification: { count: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { retrospectiveRepository } from '@/lib/repositories/retrospective.repository'

const snapFind = prisma.taskForecastSnapshot.findUnique as jest.Mock
const snapCreate = prisma.taskForecastSnapshot.create as jest.Mock
const taskFind = prisma.task.findUnique as jest.Mock
const taskCount = prisma.task.count as jest.Mock
const notifCount = prisma.notification.count as jest.Mock

beforeEach(() => {
  ;[snapFind, snapCreate, taskFind, taskCount, notifCount].forEach(m =>
    m.mockReset()
  )
})

it('loadActuals sums session usage, counts sessions and clarify notifications', async () => {
  const t0 = new Date('2024-01-01T00:00:00Z')
  taskFind.mockResolvedValue({
    projectId: 'p1',
    sessions: [
      {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 5,
        cacheCreationTokens: 0,
        startedAt: t0,
        lastActivityAt: t0,
      },
      {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        startedAt: t0,
        lastActivityAt: t0,
      },
    ],
  })
  notifCount.mockResolvedValue(2)

  const a = await retrospectiveRepository.loadActuals('t1')
  expect(a).toEqual({
    projectId: 'p1',
    tokenCost: 38,
    iterations: 2,
    clarifyRounds: 2,
    totalDurationSec: 0,
  })
})

it('loadActuals returns tokenCost null when no session carries usage', async () => {
  const t0 = new Date('2024-01-01T00:00:00Z')
  taskFind.mockResolvedValue({
    projectId: 'p1',
    sessions: [
      {
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        startedAt: t0,
        lastActivityAt: t0,
      },
    ],
  })
  notifCount.mockResolvedValue(0)
  const a = await retrospectiveRepository.loadActuals('t1')
  expect(a).toEqual({
    projectId: 'p1',
    tokenCost: null,
    iterations: 1,
    clarifyRounds: 0,
    totalDurationSec: 0,
  })
})

it('loadActuals returns null when the task is missing', async () => {
  taskFind.mockResolvedValue(null)
  expect(await retrospectiveRepository.loadActuals('nope')).toBeNull()
})

it('createSnapshotIfAbsent swallows unique-violation (keep-first)', async () => {
  snapCreate.mockRejectedValue(
    Object.assign(new Error('unique'), { code: 'P2002' })
  )
  await expect(
    retrospectiveRepository.createSnapshotIfAbsent('t1', {
      iterations: null,
      clarifyRounds: null,
      tokenCost: null,
      cohortSize: 0,
      tokenCostBasis: 0,
    })
  ).resolves.toBeUndefined()
})

it('createSnapshotIfAbsent rethrows non-P2002 errors', async () => {
  snapCreate.mockRejectedValue(
    Object.assign(new Error('boom'), { code: 'P2003' })
  )
  await expect(
    retrospectiveRepository.createSnapshotIfAbsent('t1', {
      iterations: null,
      clarifyRounds: null,
      tokenCost: null,
      cohortSize: 0,
      tokenCostBasis: 0,
    })
  ).rejects.toThrow('boom')
})

it('countReferenceLibrary counts DONE tasks with sessions', async () => {
  taskCount.mockResolvedValue(27)
  expect(await retrospectiveRepository.countReferenceLibrary('p1')).toBe(27)
  expect(taskCount).toHaveBeenCalledWith({
    where: { projectId: 'p1', status: 'DONE', sessions: { some: {} } },
  })
})

describe('loadActuals — totalDurationSec', () => {
  it('sums each session lastActivityAt − startedAt (seconds), incl. a still-running session', async () => {
    const base = new Date('2024-01-01T00:00:00Z')
    const sessionA = {
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      startedAt: base,
      // 10 minutes = 600s
      lastActivityAt: new Date(base.getTime() + 10 * 60 * 1000),
    }
    const sessionB = {
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      startedAt: base,
      // 5 minutes = 300s — still "running" (no STOP event), frozen at lastActivityAt
      lastActivityAt: new Date(base.getTime() + 5 * 60 * 1000),
    }
    taskFind.mockResolvedValue({
      projectId: 'p1',
      sessions: [sessionA, sessionB],
    })
    notifCount.mockResolvedValue(0)

    const actuals = await retrospectiveRepository.loadActuals('t1')
    expect(actuals?.totalDurationSec).toBe(900)
  })

  it('is 0 when the task has no sessions', async () => {
    taskFind.mockResolvedValue({
      projectId: 'p1',
      sessions: [],
    })
    notifCount.mockResolvedValue(0)

    const actuals = await retrospectiveRepository.loadActuals('t1')
    expect(actuals?.totalDurationSec).toBe(0)
  })

  it('never goes negative when lastActivityAt === startedAt', async () => {
    const t0 = new Date('2024-06-01T12:00:00Z')
    taskFind.mockResolvedValue({
      projectId: 'p1',
      sessions: [
        {
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheCreationTokens: null,
          startedAt: t0,
          lastActivityAt: t0,
        },
      ],
    })
    notifCount.mockResolvedValue(0)

    const actuals = await retrospectiveRepository.loadActuals('t1')
    expect(actuals?.totalDurationSec).toBe(0)
  })
})
