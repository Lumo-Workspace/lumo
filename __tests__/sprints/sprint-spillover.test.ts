/**
 * @jest-environment node
 */
// LUM-1281 — where a closed sprint's carried-over tasks went: the pure fold,
// the workspace-filtered repository reads, and the service wiring.

const mockTaskFindMany = jest.fn()
const mockSprintFindMany = jest.fn()
const mockActivityFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findMany: (...a: unknown[]) => mockTaskFindMany(...a) },
    sprint: { findMany: (...a: unknown[]) => mockSprintFindMany(...a) },
    taskActivity: {
      findMany: (...a: unknown[]) => mockActivityFindMany(...a),
    },
  },
}))

import {
  foldSpillover,
  latestDestinations,
  spilloverDestinationId,
} from '@/lib/summaries/sprint-spillover'
import { sprintRepository } from '@/lib/repositories/sprint.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { sprintSpilloverService } from '@/lib/services/sprint-spillover.service'

beforeEach(() => jest.clearAllMocks())

describe('pure fold', () => {
  test('reads the destination id from the SPRINT_CHANGED payload; null = backlog', () => {
    expect(
      spilloverDestinationId({ fromSprintId: 's1', toSprintId: 's2' })
    ).toBe('s2')
    expect(
      spilloverDestinationId({ fromSprintId: 's1', toSprintId: null })
    ).toBeNull()
    expect(spilloverDestinationId(null)).toBeNull()
  })

  test("a task's latest move out wins", () => {
    const d = latestDestinations([
      { taskId: 't1', payload: { toSprintId: 's2' } },
      { taskId: 't1', payload: { toSprintId: null } },
      { taskId: 't2', payload: { toSprintId: 's2' } },
    ])
    expect([...d.entries()]).toEqual([
      ['t1', null],
      ['t2', 's2'],
    ])
  })

  test('one row per visible task in task order; unknown destination sprint reads as backlog', () => {
    const items = foldSpillover(
      new Map<string, string | null>([
        ['t1', 's14'],
        ['t2', null],
        ['t3', 'gone'],
        ['hidden', 's14'],
      ]),
      [
        { id: 't2', identifier: 'LUM-2', title: 'B' },
        { id: 't1', identifier: 'LUM-1', title: 'A' },
        { id: 't3', identifier: 'LUM-3', title: 'C' },
      ],
      [{ id: 's14', number: 14, name: 'Sprint 14' }]
    )
    expect(items).toEqual([
      { taskId: 't2', identifier: 'LUM-2', title: 'B', to: null },
      {
        taskId: 't1',
        identifier: 'LUM-1',
        title: 'A',
        to: { number: 14, name: 'Sprint 14' },
      },
      { taskId: 't3', identifier: 'LUM-3', title: 'C', to: null },
    ])
  })
})

describe('repository reads are workspace-filtered', () => {
  test('spilloverTaskRefs: live tasks in the caller workspace, identifier from team + number', async () => {
    mockTaskFindMany.mockResolvedValueOnce([
      { id: 't1', number: 7, title: 'A', team: { identifier: 'LUM' } },
    ])
    const rows = await sprintRepository.spilloverTaskRefs(['t1', 't9'], 'ws1')
    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['t1', 't9'] },
          workspaceId: 'ws1',
          deletedAt: null,
        },
        orderBy: { number: 'asc' },
      })
    )
    expect(rows).toEqual([{ id: 't1', identifier: 'LUM-7', title: 'A' }])
  })

  test('refsByIds: sprints whose team is in the caller workspace', async () => {
    mockSprintFindMany.mockResolvedValueOnce([])
    await sprintRepository.refsByIds(['s2'], 'ws1')
    expect(mockSprintFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['s2'] }, team: { workspaceId: 'ws1' } },
      select: { id: true, number: true, name: true },
    })
  })

  test('empty id lists skip the query', async () => {
    expect(await sprintRepository.spilloverTaskRefs([], 'ws1')).toEqual([])
    expect(await sprintRepository.refsByIds([], 'ws1')).toEqual([])
    expect(mockTaskFindMany).not.toHaveBeenCalled()
    expect(mockSprintFindMany).not.toHaveBeenCalled()
  })

  test('listSpilloverFromSprint reads oldest first', async () => {
    mockActivityFindMany.mockResolvedValueOnce([])
    await activityRepository.listSpilloverFromSprint('s1')
    expect(mockActivityFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type: 'SPRINT_CHANGED',
          payload: { path: ['fromSprintId'], equals: 's1' },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    )
  })
})

describe('sprintSpilloverService.listForSprint', () => {
  test('folds the activities with the workspace-filtered task and sprint reads', async () => {
    mockActivityFindMany.mockResolvedValueOnce([
      { taskId: 't1', payload: { fromSprintId: 's13', toSprintId: 's14' } },
      { taskId: 't2', payload: { fromSprintId: 's13', toSprintId: null } },
    ])
    mockTaskFindMany.mockResolvedValueOnce([
      { id: 't1', number: 1, title: 'A', team: { identifier: 'LUM' } },
      { id: 't2', number: 2, title: 'B', team: { identifier: 'LUM' } },
    ])
    mockSprintFindMany.mockResolvedValueOnce([
      { id: 's14', number: 14, name: 'Sprint 14' },
    ])

    const items = await sprintSpilloverService.listForSprint({
      id: 's13',
      workspaceId: 'ws1',
    })

    expect(mockTaskFindMany.mock.calls[0]![0].where).toEqual({
      id: { in: ['t1', 't2'] },
      workspaceId: 'ws1',
      deletedAt: null,
    })
    expect(mockSprintFindMany.mock.calls[0]![0].where).toEqual({
      id: { in: ['s14'] },
      team: { workspaceId: 'ws1' },
    })
    expect(items).toEqual([
      {
        taskId: 't1',
        identifier: 'LUM-1',
        title: 'A',
        to: { number: 14, name: 'Sprint 14' },
      },
      { taskId: 't2', identifier: 'LUM-2', title: 'B', to: null },
    ])
  })

  test('no spillover → empty list, no task or sprint reads', async () => {
    mockActivityFindMany.mockResolvedValueOnce([])
    expect(
      await sprintSpilloverService.listForSprint({
        id: 's13',
        workspaceId: 'ws1',
      })
    ).toEqual([])
    expect(mockTaskFindMany).not.toHaveBeenCalled()
    expect(mockSprintFindMany).not.toHaveBeenCalled()
  })
})
