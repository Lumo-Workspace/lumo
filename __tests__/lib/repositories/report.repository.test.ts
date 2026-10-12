/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    taskActivity: { findMany: jest.fn() },
    task: { findMany: jest.fn() },
    hookEvent: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { reportRepository } from '@/lib/repositories/report.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

const p = prisma as unknown as {
  taskActivity: { findMany: jest.Mock }
  task: { findMany: jest.Mock }
  hookEvent: { findMany: jest.Mock }
}

beforeEach(() => {
  jest.resetAllMocks()
  p.taskActivity.findMany.mockResolvedValue([])
  p.task.findMany.mockResolvedValue([])
  p.hookEvent.findMany.mockResolvedValue([])
})

describe('reportRepository', () => {
  it('scopes DONE transitions to the workspace, current DONE status and non-trashed tasks', async () => {
    const since = new Date('2026-10-06T00:00:00Z')
    await reportRepository.listDoneTransitionsSince({
      workspaceId: 'w1',
      since,
      projectId: 'p1',
    })
    const where = p.taskActivity.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      type: 'STATUS_CHANGED',
      createdAt: { gte: since },
      task: {
        workspaceId: 'w1',
        status: 'DONE',
        deletedAt: null,
        projectId: 'p1',
      },
    })
  })

  it('reads task display rows only from the caller workspace and flattens the assignee', async () => {
    p.task.findMany.mockResolvedValue([
      {
        id: 't1',
        number: 7,
        title: 'Human',
        team: { identifier: 'LUM' },
        assignee: { memberId: 'm1', agent: null },
      },
      {
        id: 't2',
        number: 8,
        title: 'Personal agent',
        team: { identifier: 'LUM' },
        assignee: { memberId: null, agent: { name: 'Bot', memberId: 'm2' } },
      },
      {
        id: 't3',
        number: 9,
        title: 'Unassigned',
        team: { identifier: 'LUM' },
        assignee: null,
      },
    ])
    const rows = await reportRepository.findTasksForReport('w1', [
      't1',
      't2',
      't3',
    ])
    expect(p.task.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['t1', 't2', 't3'] },
      workspaceId: 'w1',
      deletedAt: null,
    })
    expect(rows).toEqual([
      {
        id: 't1',
        identifier: 'LUM-7',
        title: 'Human',
        assigneeMemberId: 'm1',
        assigneeAgentName: null,
      },
      {
        id: 't2',
        identifier: 'LUM-8',
        title: 'Personal agent',
        assigneeMemberId: 'm2',
        assigneeAgentName: 'Bot',
      },
      {
        id: 't3',
        identifier: 'LUM-9',
        title: 'Unassigned',
        assigneeMemberId: null,
        assigneeAgentName: null,
      },
    ])
  })

  it('skips the query for an empty id list', async () => {
    expect(await reportRepository.findTasksForReport('w1', [])).toEqual([])
    expect(p.task.findMany).not.toHaveBeenCalled()
  })

  it('lists project task ids within the workspace', async () => {
    p.task.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    expect(await reportRepository.listProjectTaskIds('w1', 'p1')).toEqual([
      'a',
      'b',
    ])
    expect(p.task.findMany.mock.calls[0][0].where).toEqual({
      workspaceId: 'w1',
      projectId: 'p1',
    })
  })
})

describe('hookEventRepository.findToolAttributionEvents window scope', () => {
  it('adds an exclusive until, member and task filters, and selects taskId', async () => {
    const since = new Date('2026-10-06T00:00:00Z')
    const until = new Date('2026-10-13T00:00:00Z')
    await hookEventRepository.findToolAttributionEvents({
      workspaceId: 'w1',
      since,
      until,
      workspaceMemberId: 'm1',
      taskIds: ['t1'],
    })
    expect(p.hookEvent.findMany.mock.calls[0][0].where).toMatchObject({
      workspaceId: 'w1',
      createdAt: { gte: since, lt: until },
      workspaceMemberId: 'm1',
      taskId: { in: ['t1'] },
    })
    expect(p.hookEvent.findMany.mock.calls[0][0].select.taskId).toBe(true)
  })

  it('keeps the open-ended workspace scope unchanged for lumo cost', async () => {
    const since = new Date('2026-10-06T00:00:00Z')
    await hookEventRepository.findToolAttributionEvents({
      workspaceId: 'w1',
      since,
    })
    const where = p.hookEvent.findMany.mock.calls[0][0].where
    expect(where.createdAt).toEqual({ gte: since })
    expect(where).not.toHaveProperty('workspaceMemberId')
    expect(where).not.toHaveProperty('taskId')
  })
})
