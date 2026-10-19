/**
 * @jest-environment node
 *
 * LUM-1233 (2026-10-19): GET /api/tasks/me (`lumo task list`) runs the one
 * workspace task query — every `task search` filter, `assignee=any`, `q` with
 * the same ranking — while the params older CLIs send keep their meaning
 * (only params were added). The route drives the real service + repository
 * against a mocked Prisma, so the WHERE asserted here is the one that runs.
 */
const mockFindMany = jest.fn()
const mockCount = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findMany: (...a: unknown[]) => mockFindMany(...a),
      count: (...a: unknown[]) => mockCount(...a),
    },
  },
}))
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/actor', () => ({ getHumanActorId: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: { findAssignedTasks: jest.fn(async () => []) },
  viewRepository: {
    findOrCreateMemberKanban: jest.fn(async () => ({ id: 'view-1' })),
    findTaskOrders: jest.fn(async () => []),
  },
}))
jest.mock('@/lib/repositories/task-dependency.repository', () => ({
  taskDependencyRepository: {
    findConfirmedBlocksEdgesTouching: jest.fn(async () => []),
  },
}))

import { requireIdentity } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { GET } from '@/app/api/tasks/me/route'
import { taskRepository } from '@/lib/repositories/task.repository'
import { taskListFilters } from '@/lib/services/task-query.service'

const req = (qs: string) => new Request(`http://localhost/api/tasks/me${qs}`)

function dbRow(id: string) {
  return {
    id,
    number: 1,
    title: 't',
    status: 'TODO',
    priority: 'HIGH',
    team: { identifier: 'LUM' },
    project: { id: 'p', name: 'lumo', owner: null },
    taskTags: [],
  }
}

/** The WHERE of the paged findMany (the one with skip/take). */
const pagedWhere = () =>
  mockFindMany.mock.calls.find(c => 'skip' in c[0])![0].where

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireIdentity as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
    memberId: 'm1',
  })
  ;(getHumanActorId as jest.Mock).mockResolvedValue('act-me')
  mockCount.mockResolvedValue(1)
  mockFindMany.mockResolvedValue([dbRow('t1')])
})
afterEach(() => jest.restoreAllMocks())

describe('taskListFilters (the assignee scope)', () => {
  it('defaults to the caller, widens with any, honours explicit assignees', () => {
    expect(taskListFilters('act-me', {})).toEqual({
      assigneeActorIds: ['act-me'],
    })
    expect(taskListFilters('act-me', { assignee: 'me' })).toEqual({
      assigneeActorIds: ['act-me'],
    })
    expect(taskListFilters('act-me', { assignee: 'any' })).toEqual({})
    expect(taskListFilters('act-me', { unassigned: true })).toEqual({
      unassigned: true,
    })
    expect(
      taskListFilters('act-me', { assigneeActorIds: ['act-alice'] })
    ).toEqual({ assigneeActorIds: ['act-alice'] })
  })

  it('a caller without an actor: "me" is empty, any still lists', () => {
    expect(taskListFilters(null, {})).toBeNull()
    expect(taskListFilters(null, { assignee: 'any' })).toEqual({})
  })
})

describe('GET /api/tasks/me — the unified task-list query', () => {
  it('old CLI params: same filters, still only my tasks', async () => {
    const res = await GET(
      req('?limit=50&statuses=TODO&milestoneIds=m1&projectName=Lumo')
    )
    const body = await res.json()
    expect(pagedWhere()).toEqual({
      workspaceId: 'w1',
      project: { name: { equals: 'Lumo', mode: 'insensitive' } },
      milestoneId: { in: ['m1'] },
      status: { in: ['TODO'] },
      assigneeActorId: { in: ['act-me'] },
    })
    expect(body).toMatchObject({ total: 1, nextCursor: null, truncated: false })
    expect(body.tasks[0].teamIdentifier).toBe('LUM')
  })

  it('a repeated value ORs (one IN list), different filters AND (one WHERE)', async () => {
    const after = '2026-09-01T00:00:00.000Z'
    const before = '2026-10-01T00:00:00.000Z'
    await GET(
      req(
        `?limit=50&statuses=TODO,IN_PROGRESS&priorities=HIGH,URGENT&tagIds=t1,t2` +
          `&assigneeActorIds=a1,a2&unassigned=1&projectIds=p1&sprintIds=s1` +
          `&dueAfter=${after}&dueBefore=${before}`
      )
    )
    const where = pagedWhere()
    expect(where).toMatchObject({
      workspaceId: 'w1',
      projectId: { in: ['p1'] },
      status: { in: ['TODO', 'IN_PROGRESS'] },
      priority: { in: ['HIGH', 'URGENT'] },
      taskTags: { some: { tagId: { in: ['t1', 't2'] } } },
      sprintId: { in: ['s1'] },
      OR: [
        { assigneeActorId: { in: ['a1', 'a2'] } },
        { assigneeActorId: null },
      ],
      dueDate: { gte: new Date(after), lt: new Date(before) },
    })
    // Explicit assignees replace the "me" default.
    expect(where.assigneeActorId).toBeUndefined()
  })

  it('assignee=any drops the assignee filter; unassigned=1 alone is the unassigned set', async () => {
    await GET(req('?limit=50&assignee=any'))
    expect(pagedWhere()).toEqual({ workspaceId: 'w1' })
    mockFindMany.mockClear()
    await GET(req('?limit=50&unassigned=1'))
    expect(pagedWhere()).toMatchObject({
      workspaceId: 'w1',
      assigneeActorId: null,
    })
  })

  it('q + match=exact: every term must match (AND of ORs), board order', async () => {
    await GET(req('?limit=50&assignee=any&q=oauth%20LUM-42&match=exact'))
    const where = pagedWhere()
    expect(where.AND).toHaveLength(2)
    expect(where.AND[1].OR).toContainEqual({ number: 42 })
  })

  it('q + match=fuzzy: ranked like the old task search, truncated at the cap', async () => {
    const rank = jest
      .spyOn(taskRepository, 'rankTextMatches')
      .mockResolvedValue(
        Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, score: i }))
      )
    mockFindMany.mockImplementation(async (args: { select?: unknown }) =>
      args.select
        ? Array.from({ length: 500 }, (_, i) => ({ id: `t${i}` }))
        : [dbRow('t499'), dbRow('t498')]
    )
    const body = await (
      await GET(req('?limit=2&assignee=any&q=serch&match=fuzzy'))
    ).json()
    expect(rank).toHaveBeenCalledWith('w1', ['serch'])
    // Highest score first: the page is t499, t498.
    const pageQuery = mockFindMany.mock.calls.find(
      c => !c[0].select && c[0].where.id
    )![0]
    expect(pageQuery.where).toEqual({
      workspaceId: 'w1',
      id: { in: ['t499', 't498'] },
    })
    expect(pageQuery.include.assignee).toBeDefined()
    expect(body).toMatchObject({ total: 500, nextCursor: '2', truncated: true })
  })

  it('cross-workspace: ids from another workspace never widen the scope', async () => {
    ;(requireIdentity as jest.Mock).mockResolvedValue({
      workspaceId: 'w-other',
      memberId: 'm9',
    })
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)
    const body = await (
      await GET(
        req('?limit=50&assigneeActorIds=act-me&tagIds=t1&projectIds=p1')
      )
    ).json()
    expect(pagedWhere().workspaceId).toBe('w-other')
    expect(mockCount.mock.calls[0]![0].where.workspaceId).toBe('w-other')
    expect(body).toMatchObject({ tasks: [], total: 0 })
  })

  it('a member with no actor: "me" is an empty page; assignee=any still lists', async () => {
    ;(getHumanActorId as jest.Mock).mockResolvedValue(null)
    const empty = await (await GET(req('?limit=50'))).json()
    expect(empty).toEqual({
      tasks: [],
      myTasksViewId: null,
      total: 0,
      nextCursor: null,
      truncated: false,
    })
    expect(mockFindMany).not.toHaveBeenCalled()
    const any = await (await GET(req('?limit=50&assignee=any'))).json()
    expect(any.tasks).toHaveLength(1)
  })

  it('rejects bad values with 400', async () => {
    for (const qs of [
      '?limit=50&assignee=everyone',
      '?limit=50&priorities=HUGE',
      '?limit=50&q=x&match=wild',
      '?limit=50&dueAfter=not-a-date',
    ]) {
      expect((await GET(req(qs))).status).toBe(400)
    }
    expect(mockFindMany).not.toHaveBeenCalled()
  })
})
