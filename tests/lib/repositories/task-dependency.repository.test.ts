/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskDependency: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    task: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { taskDependencyRepository } from '@/lib/repositories/task-dependency.repository'

const p = prisma as unknown as Record<string, Record<string, jest.Mock>>

beforeEach(() => jest.clearAllMocks())

// ── createManySuggested ───────────────────────────────────────────────────────

describe('taskDependencyRepository.createManySuggested', () => {
  it('stamps DETECTED/SUGGESTED/BLOCKS and skips duplicates', async () => {
    p.taskDependency!.createMany!.mockResolvedValueOnce({ count: 1 })
    await taskDependencyRepository.createManySuggested([
      {
        workspaceId: 'w1',
        blockedTaskId: 'a',
        blockingTaskId: 'b',
        reason: 'task_mention',
        detail: { surface: 'comment' },
      },
    ])
    expect(p.taskDependency!.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          kind: 'BLOCKS',
          source: 'DETECTED',
          status: 'SUGGESTED',
          reason: 'task_mention',
        }),
      ],
      skipDuplicates: true,
    })
  })

  it('short-circuits on empty input', async () => {
    await expect(
      taskDependencyRepository.createManySuggested([])
    ).resolves.toEqual({ count: 0 })
    expect(p.taskDependency!.createMany).not.toHaveBeenCalled()
  })
})

// ── findLiveBlockersForTask ───────────────────────────────────────────────────

describe('taskDependencyRepository.findLiveBlockersForTask', () => {
  it('filters CONFIRMED BLOCKS with non-DONE blocker', async () => {
    p.taskDependency!.findMany!.mockResolvedValueOnce([])
    await taskDependencyRepository.findLiveBlockersForTask('t1')
    expect(p.taskDependency!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          blockedTaskId: 't1',
          status: 'CONFIRMED',
          kind: 'BLOCKS',
          blockingTask: { status: { not: 'DONE' } },
        },
      })
    )
  })
})

// ── findPairsAmong ────────────────────────────────────────────────────────────

describe('taskDependencyRepository.findPairsAmong', () => {
  it('queries both directions in an OR clause for each pair', async () => {
    p.taskDependency!.findMany!.mockResolvedValueOnce([])
    await taskDependencyRepository.findPairsAmong([
      { a: 'task1', b: 'task2' },
      { a: 'task3', b: 'task4' },
    ])
    expect(p.taskDependency!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { blockedTaskId: 'task1', blockingTaskId: 'task2' },
            { blockedTaskId: 'task2', blockingTaskId: 'task1' },
            { blockedTaskId: 'task3', blockingTaskId: 'task4' },
            { blockedTaskId: 'task4', blockingTaskId: 'task3' },
          ],
        },
      })
    )
  })

  it('short-circuits on empty pairs input', async () => {
    const result = await taskDependencyRepository.findPairsAmong([])
    expect(result).toEqual([])
    expect(p.taskDependency!.findMany).not.toHaveBeenCalled()
  })
})

// ── findTaskIdsInWorkspace ────────────────────────────────────────────────────

describe('taskDependencyRepository.findTaskIdsInWorkspace', () => {
  it('returns mapped ids filtered to the workspace', async () => {
    p.task!.findMany!.mockResolvedValueOnce([
      { id: 'task1' },
      { id: 'task2' },
    ])
    const result = await taskDependencyRepository.findTaskIdsInWorkspace(
      ['task1', 'task2', 'task3'],
      'ws1'
    )
    expect(result).toEqual(['task1', 'task2'])
    expect(p.task!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['task1', 'task2', 'task3'] },
          project: { workspaceId: 'ws1' },
        },
      })
    )
  })

  it('short-circuits on empty ids input', async () => {
    const result = await taskDependencyRepository.findTaskIdsInWorkspace(
      [],
      'ws1'
    )
    expect(result).toEqual([])
    expect(p.task!.findMany).not.toHaveBeenCalled()
  })
})
