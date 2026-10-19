/**
 * @jest-environment node
 *
 * LUM-1093: server-side paging for `lumo task list` (GET /api/tasks/me) and
 * `lumo task search` (GET /api/tasks/workspace). `limit` / `cursor` switch
 * the routes to the paged shape (+ total, nextCursor); without them the web
 * callers keep the legacy full list. The last test drives the real CLI
 * through the real /api/tasks/me route and follows the printed next-page
 * command to page 2.
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/actor', () => ({ getHumanActorId: jest.fn() }))
const mockFindAssignedTasks = jest.fn()
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findAssignedTasks: (...a: unknown[]) => mockFindAssignedTasks(...a),
  },
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
const mockAssignedPage = jest.fn()
const mockWorkspacePage = jest.fn()
const mockWorkspaceAll = jest.fn()
jest.mock('@/lib/repositories/task.repository', () => ({
  WORKSPACE_TASK_QUERY_LIMIT: 500,
  taskRepository: {
    findTaskListPage: (...a: unknown[]) => mockAssignedPage(...a),
    findByWorkspaceWithFiltersPage: (...a: unknown[]) =>
      mockWorkspacePage(...a),
    findByWorkspaceWithFilters: (...a: unknown[]) => mockWorkspaceAll(...a),
  },
}))
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

import type { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { GET as getMe } from '@/app/api/tasks/me/route'
import { GET as getWorkspace } from '@/app/api/tasks/workspace/route'
import { taskList } from '@/cli/src/commands/task-list'

function row(n: number) {
  return {
    id: `t${n}`,
    number: n,
    title: `Task ${n}`,
    status: 'TODO',
    priority: 'LOW',
    milestoneId: null,
    team: { identifier: 'LUM' },
    project: { id: 'p', name: 'lumo', owner: null },
    taskTags: [],
  }
}
const ALL = Array.from({ length: 120 }, (_, i) => row(i + 1))

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireIdentity as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
    memberId: 'm1',
  })
  ;(getHumanActorId as jest.Mock).mockResolvedValue('act-1')
  mockAssignedPage.mockImplementation(
    async (
      _w: string,
      _f: unknown,
      page: { offset: number; limit: number }
    ) => ({
      rows: ALL.slice(page.offset, page.offset + page.limit),
      total: ALL.length,
      truncated: false,
    })
  )
})

const meReq = (qs: string) => new Request(`http://localhost/api/tasks/me${qs}`)

describe('GET /api/tasks/me paging', () => {
  it('legacy call (no limit/cursor) keeps the full list and no paging fields', async () => {
    mockFindAssignedTasks.mockResolvedValue(ALL.slice(0, 3))
    const body = await (await getMe(meReq(''))).json()
    expect(body.tasks).toHaveLength(3)
    expect(body).not.toHaveProperty('total')
    expect(body).not.toHaveProperty('nextCursor')
    expect(mockAssignedPage).not.toHaveBeenCalled()
  })

  it('paged call passes workspace, filters and page to the service path', async () => {
    const res = await getMe(
      meReq(
        '?limit=50&cursor=50&statuses=TODO,DONE&milestoneIds=m1&projectName=Lumo'
      )
    )
    const body = await res.json()
    expect(mockAssignedPage).toHaveBeenCalledWith(
      'w1',
      {
        statuses: ['TODO', 'DONE'],
        milestoneIds: ['m1'],
        projectName: 'Lumo',
        assigneeActorIds: ['act-1'],
      },
      { offset: 50, limit: 50 }
    )
    expect(body.tasks).toHaveLength(50)
    expect(body.tasks[0].number).toBe(51)
    expect(body.total).toBe(120)
    expect(body.nextCursor).toBe('100')
    expect(mockFindAssignedTasks).not.toHaveBeenCalled()
  })

  it('last page has nextCursor null', async () => {
    const body = await (await getMe(meReq('?cursor=100'))).json()
    expect(body.tasks).toHaveLength(20)
    expect(body.nextCursor).toBeNull()
  })

  it('rejects a bad cursor / limit / status with 400', async () => {
    expect((await getMe(meReq('?cursor=abc'))).status).toBe(400)
    expect((await getMe(meReq('?limit=0'))).status).toBe(400)
    expect((await getMe(meReq('?limit=10&statuses=NOPE'))).status).toBe(400)
    expect(mockAssignedPage).not.toHaveBeenCalled()
  })
})

describe('GET /api/tasks/workspace paging', () => {
  const wsReq = (qs: string) =>
    new Request(
      `http://localhost/api/tasks/workspace${qs}`
    ) as unknown as NextRequest

  it('paged call returns total + nextCursor and keeps the workspace scope', async () => {
    mockWorkspacePage.mockResolvedValue({
      rows: [{ id: 't1', team: { identifier: 'LUM' } }],
      total: 7,
    })
    const body = await (
      await getWorkspace(wsReq('?statuses=TODO&limit=1'))
    ).json()
    expect(mockWorkspacePage).toHaveBeenCalledWith(
      'w1',
      { statuses: ['TODO'] },
      { offset: 0, limit: 1 }
    )
    expect(body).toEqual({
      tasks: [{ id: 't1', team: { identifier: 'LUM' }, teamIdentifier: 'LUM' }],
      total: 7,
      nextCursor: '1',
    })
    expect(mockWorkspaceAll).not.toHaveBeenCalled()
  })

  it('paged fuzzy call passes the capped signal through', async () => {
    mockWorkspacePage.mockResolvedValue({
      rows: [],
      total: 500,
      truncated: true,
    })
    const body = await (
      await getWorkspace(wsReq('?q=serch&match=fuzzy&cursor=500'))
    ).json()
    expect(body).toMatchObject({
      total: 500,
      nextCursor: null,
      truncated: true,
    })
  })

  it('legacy call keeps { tasks, truncated }', async () => {
    mockWorkspaceAll.mockResolvedValue([])
    const body = await (await getWorkspace(wsReq(''))).json()
    expect(body).toEqual({ tasks: [], truncated: false })
    expect(mockWorkspacePage).not.toHaveBeenCalled()
  })

  it('rejects a bad cursor with 400', async () => {
    expect((await getWorkspace(wsReq('?cursor=-1'))).status).toBe(400)
  })
})

describe('e2e: lumo task list → /api/tasks/me → printed command → page 2', () => {
  let out: string
  beforeEach(() => {
    out = ''
    jest.spyOn(process.stdout, 'write').mockImplementation(s => {
      out += String(s)
      return true
    })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    global.fetch = jest.fn(async (url: string) =>
      getMe(new Request(String(url)))
    ) as unknown as typeof fetch
  })
  afterEach(() => jest.restoreAllMocks())

  it('follows the footer command to the second page', async () => {
    expect(await taskList({})).toBeUndefined()
    expect(out).toContain('Showing 1-50 of 120.')
    const m = /^Next page: lumo task list --cursor (\S+)$/m.exec(out)
    expect(m).not.toBeNull()

    out = ''
    expect(await taskList({ cursor: m![1]! })).toBeUndefined()
    const ids = out.split('\n').filter(l => /^LUM-\d+/.test(l))
    expect(ids[0]).toMatch(/^LUM-51\s/)
    expect(ids).toHaveLength(50)
    expect(out).toContain('Showing 51-100 of 120.')
    expect(out).toContain('Next page: lumo task list --cursor 100')
  })
})
