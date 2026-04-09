/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskActivity: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { activityRepository } from '@/lib/repositories/activity.repository'

const mockCreate = prisma.taskActivity.create as jest.Mock
const mockFindMany = prisma.taskActivity.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('activityRepository.create', () => {
  it('creates an activity record', async () => {
    const data = {
      taskId: 'task-1',
      actorId: 'actor-1',
      type: 'STATUS_CHANGED' as const,
      payload: { from: 'TODO', to: 'IN_PROGRESS' },
    }
    mockCreate.mockResolvedValue({
      id: 'act-1',
      ...data,
      createdAt: new Date(),
    })
    const result = await activityRepository.create(data)
    expect(mockCreate).toHaveBeenCalledWith({ data })
    expect(result.id).toBe('act-1')
  })

  it('creates with a transaction client', async () => {
    const txCreate = jest.fn().mockResolvedValue({ id: 'act-2' })
    const tx = { taskActivity: { create: txCreate } }
    const data = {
      taskId: 'task-1',
      actorId: null,
      type: 'TASK_CREATED' as const,
      payload: {},
    }
    await activityRepository.create(data, tx as any)
    expect(txCreate).toHaveBeenCalledWith({ data })
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('activityRepository.findByTaskId', () => {
  it('returns activities ordered by createdAt ASC with limit+1', async () => {
    const activities = [
      { id: 'a1', createdAt: new Date('2026-01-01') },
      { id: 'a2', createdAt: new Date('2026-01-02') },
    ]
    mockFindMany.mockResolvedValue(activities)
    const result = await activityRepository.findByTaskId('task-1', {
      limit: 30,
    })
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: 'task-1' },
        orderBy: { createdAt: 'asc' },
        take: 31,
      })
    )
    expect(result).toEqual(activities)
  })

  it('applies cursor filter when provided', async () => {
    mockFindMany.mockResolvedValue([])
    await activityRepository.findByTaskId('task-1', {
      limit: 30,
      cursor: { timestamp: '2026-01-01T00:00:00.000Z', id: 'a1' },
    })
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          taskId: 'task-1',
          OR: [
            { createdAt: { gt: new Date('2026-01-01T00:00:00.000Z') } },
            {
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              id: { gt: 'a1' },
            },
          ],
        },
      })
    )
  })
})
