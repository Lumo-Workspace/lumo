/**
 * @jest-environment node
 */

jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    updateTaskWithSideEffects: jest.fn(),
  },
}))

jest.mock('@/lib/repositories', () => ({
  projectRepository: { findByIdSimple: jest.fn() },
  memberRepository: { findByWorkspaceAndClerkId: jest.fn() },
  taskRepository: {
    findManyForUpdate: jest.fn(),
    createWithSequence: jest.fn(),
  },
}))

jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))

import { quickDispatchService } from '@/lib/services/quick-dispatch.service'
import { taskService } from '@/lib/services/task.service'
import { taskRepository } from '@/lib/repositories'

const updateTaskWithSideEffectsMock =
  taskService.updateTaskWithSideEffects as jest.Mock
const findManyForUpdateMock = taskRepository.findManyForUpdate as jest.Mock

beforeEach(() => jest.clearAllMocks())

// ── executeActions: batch updates → notifications dispatched ────────────────

describe('quickDispatchService.executeActions update actions', () => {
  function makeTaskCheck(id: string) {
    return {
      id,
      number: 42,
      projectId: 'p-1',
      assigneeActorId: null,
      status: 'TODO',
      project: {
        workspaceId: 'ws-1',
        workspace: { slug: 'lumo' },
      },
      team: { identifier: 'LUM' },
    }
  }

  function makeUpdateResult(id: string) {
    return {
      task: {
        id,
        projectId: 'p-1',
        title: 'updated',
        team: { identifier: 'LUM' },
        teamIdentifier: 'LUM',
        tags: [],
      },
      changedFields: ['status'],
      oldStatus: 'TODO',
      oldAssigneeActorId: null,
    }
  }

  it('pre-fetches taskChecks once for the whole batch and dispatches via updateTaskWithSideEffects', async () => {
    const t1 = makeTaskCheck('tsk-1')
    const t2 = makeTaskCheck('tsk-2')
    findManyForUpdateMock.mockResolvedValue(
      new Map([
        ['tsk-1', t1],
        ['tsk-2', t2],
      ])
    )
    updateTaskWithSideEffectsMock
      .mockResolvedValueOnce(makeUpdateResult('tsk-1'))
      .mockResolvedValueOnce(makeUpdateResult('tsk-2'))

    const results = await quickDispatchService.executeActions(
      [
        { type: 'update', taskId: 'tsk-1', fields: { status: 'IN_PROGRESS' } },
        { type: 'update', taskId: 'tsk-2', fields: { status: 'DONE' } },
      ],
      'ws-1',
      'actor-1',
      'clerk-1'
    )

    expect(findManyForUpdateMock).toHaveBeenCalledTimes(1)
    expect(findManyForUpdateMock).toHaveBeenCalledWith(
      ['tsk-1', 'tsk-2'],
      'ws-1'
    )

    expect(updateTaskWithSideEffectsMock).toHaveBeenCalledTimes(2)
    expect(updateTaskWithSideEffectsMock).toHaveBeenNthCalledWith(
      1,
      'tsk-1',
      { status: 'IN_PROGRESS' },
      t1,
      'actor-1',
      'clerk-1'
    )
    expect(updateTaskWithSideEffectsMock).toHaveBeenNthCalledWith(
      2,
      'tsk-2',
      { status: 'DONE' },
      t2,
      'actor-1',
      'clerk-1'
    )

    expect(results.every(r => r.success)).toBe(true)
  })

  it('returns failure when taskCheck is missing for an update id (task not found)', async () => {
    findManyForUpdateMock.mockResolvedValue(new Map())

    const results = await quickDispatchService.executeActions(
      [{ type: 'update', taskId: 'tsk-missing', fields: { status: 'DONE' } }],
      'ws-1',
      'actor-1',
      'clerk-1'
    )

    expect(updateTaskWithSideEffectsMock).not.toHaveBeenCalled()
    expect(results[0]).toMatchObject({
      type: 'update',
      taskId: 'tsk-missing',
      success: false,
    })
  })

  it('records per-action error without aborting the batch', async () => {
    findManyForUpdateMock.mockResolvedValue(
      new Map([
        ['tsk-1', makeTaskCheck('tsk-1')],
        ['tsk-2', makeTaskCheck('tsk-2')],
      ])
    )
    updateTaskWithSideEffectsMock
      .mockRejectedValueOnce(
        Object.assign(new Error('Invalid transition'), { status: 409 })
      )
      .mockResolvedValueOnce(makeUpdateResult('tsk-2'))

    const results = await quickDispatchService.executeActions(
      [
        { type: 'update', taskId: 'tsk-1', fields: { status: 'DONE' } },
        { type: 'update', taskId: 'tsk-2', fields: { status: 'DONE' } },
      ],
      'ws-1',
      'actor-1',
      'clerk-1'
    )

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ success: false, taskId: 'tsk-1' })
    expect(results[1]).toMatchObject({ success: true, taskId: 'tsk-2' })
  })

  it('does not call findManyForUpdate when there are no update actions', async () => {
    await quickDispatchService.executeActions([], 'ws-1', 'actor-1', 'clerk-1')
    expect(findManyForUpdateMock).not.toHaveBeenCalled()
  })
})
