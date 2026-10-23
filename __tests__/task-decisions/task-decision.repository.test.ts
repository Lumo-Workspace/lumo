/** @jest-environment node */
jest.mock('@/lib/db/workspace-scope', () => {
  const taskDecision = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    aggregate: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  }
  const task = { findMany: jest.fn(async () => []) }
  return {
    scopedPrisma: { taskDecision },
    unscoped: jest.fn(() => ({ task })),
    __task: task,
  }
})

import { scopedPrisma } from '@/lib/db/workspace-scope'
import { taskDecisionRepository } from '@/lib/repositories/task-decision.repository'

const td = scopedPrisma.taskDecision as unknown as Record<string, jest.Mock>

beforeEach(() => jest.clearAllMocks())

describe('taskDecisionRepository (LUM-1303)', () => {
  it('lists a task by number, skipping deleted ones, pinned to the workspace', async () => {
    td.findMany!.mockResolvedValue([])
    await taskDecisionRepository.listByTask('t1', 'ws_1')
    expect(td.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: 't1', workspaceId: 'ws_1', deletedAt: null },
        orderBy: { number: 'asc' },
      })
    )
  })

  it('numbers a new decision max+1 over every row of the task, deleted ones included', async () => {
    td.aggregate!.mockResolvedValue({ _max: { number: 4 } })
    td.create!.mockResolvedValue({})
    await taskDecisionRepository.createNumbered({
      taskId: 't1',
      workspaceId: 'ws_1',
      text: 'x',
      rationale: null,
      createdById: 'm1',
      sourceSessionId: null,
    })
    expect(td.aggregate).toHaveBeenCalledWith({
      where: { taskId: 't1', workspaceId: 'ws_1' },
      _max: { number: true },
    })
    expect(td.create!.mock.calls[0][0].data.number).toBe(5)
    td.aggregate!.mockResolvedValue({ _max: { number: null } })
    await taskDecisionRepository.createNumbered({
      taskId: 't2',
      workspaceId: 'ws_1',
      text: 'x',
      rationale: null,
      createdById: 'm1',
      sourceSessionId: null,
    })
    expect(td.create!.mock.calls[1][0].data.number).toBe(1)
  })

  it('redacts a secret in text / rationale before storing', async () => {
    td.aggregate!.mockResolvedValue({ _max: { number: null } })
    td.create!.mockResolvedValue({})
    await taskDecisionRepository.createNumbered({
      taskId: 't1',
      workspaceId: 'ws_1',
      text: 'use key AKIAIOSFODNN7EXAMPLE',
      rationale: null,
      createdById: 'm1',
      sourceSessionId: null,
    })
    const data = td.create!.mock.calls[0][0].data
    expect(data.text).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(data.workspaceId).toBe('ws_1')
  })

  it('update and delete address the row by id and workspace; delete is a tombstone', async () => {
    td.update!.mockResolvedValue({})
    await taskDecisionRepository.update('d1', 'ws_1', { rationale: null })
    // Only a live row: a decision deleted in the meantime is not edited.
    expect(td.update!.mock.calls[0][0].where).toEqual({
      id: 'd1',
      workspaceId: 'ws_1',
      deletedAt: null,
    })
    await taskDecisionRepository.softDelete('d1', 'ws_1')
    expect(td.update!.mock.calls[1][0]).toEqual({
      where: { id: 'd1', workspaceId: 'ws_1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    })
    expect(td.delete).not.toHaveBeenCalled()
  })

  it('backfill prefilter is loose (the heading may wrap the word in markup); trash included', async () => {
    const { __task } = jest.requireMock('@/lib/db/workspace-scope') as {
      __task: { findMany: jest.Mock }
    }
    await taskDecisionRepository.listTasksWithDecisionsHeading(null, 50)
    expect(__task.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: {},
      description: { contains: 'decisions', mode: 'insensitive' },
    })
  })
})
