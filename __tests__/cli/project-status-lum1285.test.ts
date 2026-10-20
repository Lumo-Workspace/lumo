/**
 * @jest-environment node
 *
 * LUM-1285 (CLI): project status is a human ruling (exit-4 envelope), dates
 * are validated, archived projects leave `project list`, `project show`
 * prints the lifecycle, `status --next` skips inactive projects and
 * `task create` prints the paused warning.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
}))
jest.mock('../../cli/src/lib/session-id', () => ({
  resolveSessionId: async () => undefined,
  AmbiguousSessionError: class extends Error {},
}))

import {
  describeProjectUpdate,
  projectSetArchived,
  projectUpdate,
} from '@/cli/src/commands/project-manage'
import {
  formatProjectList,
  listedProjects,
  projectListJson,
  projectStateLabel,
} from '@/cli/src/commands/project-list'
import {
  formatNextResult,
  formatSkippedInactiveProject,
  loadNext,
  nextResultJson,
  partitionByProjectWorkable,
  type NextResult,
} from '@/cli/src/commands/next'
import { taskCreate } from '@/cli/src/commands/task-create'
import { lifecycle } from '@/cli/src/commands/overview'
import {
  formatProjectOverview,
  lifecycleLines,
  type OverviewStats,
} from '@/cli/src/lib/overview-format'
import { isCalendarDay } from '@/cli/src/lib/local-day'
import { EXIT_CONFIRMATION_REQUIRED } from '@/cli/src/lib/confirmation'
import type { NextTask } from '@/cli/src/lib/rank-tasks'

let out: string
let errOut: string
let fetchMock: jest.Mock
const routes: Record<string, (init?: RequestInit) => unknown> = {}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status })

beforeEach(() => {
  out = ''
  errOut = ''
  for (const k of Object.keys(routes)) delete routes[k]
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errOut += a.map(String).join(' ') + '\n'
  })
  fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(String(url))
    const key = `${init?.method ?? 'GET'} ${u.pathname}`
    const h = routes[key]
    if (!h) throw new Error(`unexpected ${key}`)
    return h(init)
  })
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(() => jest.restoreAllMocks())

const method = (m: string) =>
  fetchMock.mock.calls.filter(c => (c[1]?.method ?? 'GET') === m)
const patchBody = () => JSON.parse(String(method('PATCH')[0]![1].body))

function projectsRoute(status = 'ACTIVE', extra: Record<string, unknown> = {}) {
  routes['GET /api/projects'] = () =>
    json({ projects: [{ id: 'p1', name: 'API', status, ...extra }] })
}

describe('project update --status (human ruling)', () => {
  beforeEach(() => {
    projectsRoute('ACTIVE')
    routes['PATCH /api/projects/p1'] = () =>
      json({ project: { id: 'p1', name: 'API', status: 'PAUSED' } })
  })

  it('without --confirm: exit 4 envelope, no PATCH', async () => {
    expect(await projectUpdate('api', { status: 'paused' })).toBe(
      EXIT_CONFIRMATION_REQUIRED
    )
    expect(method('PATCH')).toHaveLength(0)
    const env = JSON.parse(out)
    expect(env.status).toBe('confirmation_required')
    expect(env.command).toBe('project update')
    expect(env.changes[0]).toBe(
      'Will set project "API" status: ACTIVE → PAUSED'
    )
    expect(env.changes[1]).toMatch(/status --next/)
    expect(env.confirmCommand).toMatch(/ --confirm$/)
  })

  it('the envelope lists other fields changed in the same call', async () => {
    expect(
      await projectUpdate('api', { status: 'canceled', target: '2026-12-01' })
    ).toBe(EXIT_CONFIRMATION_REQUIRED)
    const env = JSON.parse(out)
    expect(env.changes).toContain('target → 2026-12-01')
    expect(env.changes[1]).toMatch(/refused/)
  })

  it('with --confirm: PATCHes the status', async () => {
    expect(
      await projectUpdate('api', { status: 'Paused', confirm: true })
    ).toBeUndefined()
    expect(patchBody()).toEqual({ status: 'PAUSED' })
    expect(out).toContain('Updated project "API" (status PAUSED)')
  })

  it('re-setting the current status needs no confirmation', async () => {
    expect(await projectUpdate('api', { status: 'active' })).toBeUndefined()
    expect(patchBody()).toEqual({ status: 'ACTIVE' })
  })

  it('a project from an older server (no status) reads as ACTIVE', async () => {
    routes['GET /api/projects'] = () =>
      json({ projects: [{ id: 'p1', name: 'API' }] })
    expect(await projectUpdate('api', { status: 'paused' })).toBe(
      EXIT_CONFIRMATION_REQUIRED
    )
    expect(JSON.parse(out).changes[0]).toContain('ACTIVE → PAUSED')
  })

  it('an unknown status is a usage error before any network call', async () => {
    expect(await projectUpdate('api', { status: 'completed' })).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('describeProjectUpdate names the move and its consequence', () => {
    const lines = describeProjectUpdate('Web', 'PAUSED', 'ACTIVE')
    expect(lines[0]).toBe('Will set project "Web" status: PAUSED → ACTIVE')
    expect(lines[1]).toMatch(/return to `lumo status --next`/)
  })
})

describe('project update --start / --target', () => {
  beforeEach(() => {
    projectsRoute()
    routes['PATCH /api/projects/p1'] = () =>
      json({ project: { id: 'p1', name: 'API' } })
  })

  it('sends both days; "" clears', async () => {
    expect(
      await projectUpdate('api', { start: '2026-11-01', target: '' })
    ).toBeUndefined()
    expect(patchBody()).toEqual({ startDate: '2026-11-01', targetDate: null })
  })

  it('refuses a target before the start (exit 2, no network)', async () => {
    expect(
      await projectUpdate('api', { start: '2026-11-10', target: '2026-11-01' })
    ).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(errOut).toMatch(/--target must be on or after --start/)
  })

  it('accepts target equal to start', async () => {
    expect(
      await projectUpdate('api', { start: '2026-11-10', target: '2026-11-10' })
    ).toBeUndefined()
  })

  it('refuses a malformed or impossible day', async () => {
    expect(await projectUpdate('api', { start: '2026-02-30' })).toBe(2)
    expect(await projectUpdate('api', { target: '11/01/2026' })).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('isCalendarDay', () => {
    expect(isCalendarDay('2026-02-28')).toBe(true)
    expect(isCalendarDay('2028-02-29')).toBe(true)
    expect(isCalendarDay('2026-02-29')).toBe(false)
    expect(isCalendarDay('2026-1-01')).toBe(false)
  })
})

describe('project archive / unarchive', () => {
  it('archive PATCHes archived: true without a confirmation', async () => {
    projectsRoute()
    routes['PATCH /api/projects/p1'] = () =>
      json({ project: { id: 'p1', name: 'API' } })
    expect(await projectSetArchived('api', true)).toBeUndefined()
    expect(patchBody()).toEqual({ archived: true })
    expect(out).toBe('Archived project "API"\n')
  })

  it('unarchive resolves an archived project and PATCHes archived: false', async () => {
    projectsRoute('ACTIVE', { archivedAt: '2026-10-01T00:00:00.000Z' })
    routes['PATCH /api/projects/p1'] = () =>
      json({ project: { id: 'p1', name: 'API' } })
    expect(await projectSetArchived('api', false)).toBeUndefined()
    expect(patchBody()).toEqual({ archived: false })
    expect(out).toBe('Unarchived project "API"\n')
  })
})

describe('project list archive filtering', () => {
  const projects = [
    { id: 'p1', name: 'Live', status: 'ACTIVE' },
    { id: 'p2', name: 'Old', status: 'PAUSED', archivedAt: '2026-10-01' },
    { id: 'p3', name: 'Idea', isIdea: true },
  ]

  it('hides archived (and idea) projects by default; --all shows archived', () => {
    expect(listedProjects(projects).map(p => p.id)).toEqual(['p1'])
    expect(listedProjects(projects, { all: true }).map(p => p.id)).toEqual([
      'p1',
      'p2',
    ])
  })

  it('table carries a STATUS column', () => {
    expect(formatProjectList(projects, { tty: false, color: false })).toBe(
      'live\tLive\tACTIVE'
    )
    expect(
      formatProjectList(projects, { tty: false, color: false, all: true })
    ).toBe('live\tLive\tACTIVE\nold\tOld\tPAUSED · archived')
  })

  it('--json keeps the lifecycle fields and honours --all', () => {
    const env = projectListJson(projects) as { projects: unknown[] }
    expect(env.projects).toHaveLength(1)
    const all = projectListJson(projects, { all: true }) as {
      projects: Array<Record<string, unknown>>
    }
    expect(all.projects[1]).toMatchObject({
      slug: 'old',
      status: 'PAUSED',
      archivedAt: '2026-10-01',
    })
  })

  it('projectStateLabel defaults a missing status to ACTIVE', () => {
    expect(projectStateLabel({ id: 'x', name: 'x' })).toBe('ACTIVE')
  })
})

describe('project show lifecycle', () => {
  const stats: OverviewStats = {
    totalTasks: 2,
    statusDistribution: { DONE: 2 },
    overdueTasks: { count: 0 },
    memberWorkload: [],
    completionTrend: [],
    avgCompletionTime: null,
  }

  it('prints status, dates and derived completion', () => {
    const text = lifecycleLines({
      status: 'PAUSED',
      startDate: '2026-11-01T00:00:00.000Z',
      targetDate: null,
      archivedAt: null,
      completed: true,
    }).join('\n')
    expect(text).toMatch(/State:\s+PAUSED/)
    expect(text).toMatch(/Start:\s+2026-11-01/)
    expect(text).toMatch(/Target:\s+-/)
    expect(text).toMatch(/Complete:\s+yes/)
  })

  it('marks an archived project and an incomplete one', () => {
    const text = lifecycleLines({
      status: 'ACTIVE',
      archivedAt: '2026-10-19T08:00:00.000Z',
      completed: false,
    }).join('\n')
    expect(text).toMatch(/State:\s+ACTIVE · archived 2026-10-19/)
    expect(text).toMatch(/Complete:\s+no/)
  })

  it('formatProjectOverview shows the block only when given', () => {
    const now = new Date('2026-10-20T00:00:00Z')
    expect(formatProjectOverview('API', stats, null, now)).not.toMatch(/State:/)
    expect(
      formatProjectOverview('API', stats, null, now, {
        lifecycle: { status: 'CANCELED', completed: false },
      })
    ).toMatch(/State:\s+CANCELED/)
  })

  it('--json adds only the lifecycle fields the server sent', () => {
    expect(lifecycle({ id: 'p', name: 'n' })).toEqual({})
    expect(
      lifecycle({
        id: 'p',
        name: 'n',
        status: 'ACTIVE',
        startDate: null,
        targetDate: '2026-12-01T00:00:00.000Z',
        archivedAt: null,
        completed: false,
      })
    ).toEqual({
      status: 'ACTIVE',
      startDate: null,
      targetDate: '2026-12-01T00:00:00.000Z',
      archivedAt: null,
      completed: false,
    })
  })
})

describe('status --next skips paused / canceled / archived projects', () => {
  const task = (
    n: number,
    project: NextTask['project'],
    extra: Partial<NextTask> = {}
  ): NextTask => ({
    id: `t${n}`,
    number: n,
    title: `Task ${n}`,
    status: 'TODO',
    priority: 'HIGH',
    teamIdentifier: 'LUM',
    sprintId: null,
    dueDate: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
    claimable: true,
    blockedByOpenCount: 0,
    ...(project !== undefined ? { project } : {}),
    ...extra,
  })

  const tasks = [
    task(1, { status: 'ACTIVE', archivedAt: null }),
    task(2, { status: 'PAUSED', archivedAt: null }),
    task(3, { status: 'CANCELED', archivedAt: null }),
    task(4, { status: 'ACTIVE', archivedAt: '2026-10-01T00:00:00.000Z' }),
    task(5, undefined), // older server: no project lifecycle
  ]

  it('partitionByProjectWorkable', () => {
    const r = partitionByProjectWorkable(tasks)
    expect(r.workable.map(t => t.number)).toEqual([1, 5])
    expect(r.skipped).toBe(3)
  })

  beforeEach(() => {
    routes['GET /api/me/active-sprints'] = () => json({ sprintIds: [] })
    routes['GET /api/tasks/me'] = () => json({ tasks })
  })

  it('loadNext ranks only workable tasks and reports the skip', async () => {
    const r = (await loadNext({ limit: '10' })) as NextResult
    expect(r.ranked.map(x => x.identifier)).toEqual(['LUM-1', 'LUM-5'])
    expect(r.poolSize).toBe(2)
    expect(r.skippedInactiveProject).toBe(3)
    expect(nextResultJson(r)).toMatchObject({ skippedInactiveProject: 3 })
    expect(formatNextResult(r, { hints: false })).toContain(
      formatSkippedInactiveProject(3)
    )
  })

  it('--claimable: inactive-project tasks are skipped before the gate', async () => {
    const r = (await loadNext({ limit: '10', claimable: true })) as NextResult
    expect(r.claimable).toBe(true)
    expect(r.ranked.map(x => x.identifier)).toEqual(['LUM-1', 'LUM-5'])
    expect(r.excluded).toEqual({ notClaimable: 0, blocked: 0, overBudget: 0 })
    expect(r.skippedInactiveProject).toBe(3)
  })

  it('nothing skipped → no note and no JSON field', async () => {
    routes['GET /api/tasks/me'] = () => json({ tasks: [tasks[0]] })
    const r = (await loadNext({})) as NextResult
    expect(r.skippedInactiveProject).toBeUndefined()
    expect(nextResultJson(r)).not.toHaveProperty('skippedInactiveProject')
    expect(formatNextResult(r, { hints: false })).not.toMatch(/skipped/)
  })
})

describe('task create into a paused / canceled project', () => {
  it('prints the server warning on stderr and still succeeds', async () => {
    routes['POST /api/tasks'] = () =>
      json(
        {
          task: {
            id: 't1',
            identifier: 'LUM-7',
            title: 'Fix',
            url: 'https://x/LUM-7',
            teamId: 'team',
          },
          nextSteps: [],
          warnings: ['Project "API" is paused — the task was created'],
        },
        201
      )
    expect(
      await taskCreate('Fix', { project: 'api', hints: false })
    ).toBeUndefined()
    expect(out).toContain('Created LUM-7 "Fix"')
    expect(out).not.toMatch(/paused/)
    expect(errOut).toMatch(/Project "API" is paused/)
  })

  it('a 409 refusal surfaces the server hint and exits 1', async () => {
    routes['POST /api/tasks'] = () =>
      json(
        {
          error:
            'Project "API" is canceled — new tasks can\'t be added. A person can reactivate it with `lumo project update api --status active`.',
        },
        409
      )
    expect(await taskCreate('Fix', { project: 'api' })).toBe(1)
    expect(errOut).toMatch(/is canceled/)
    expect(errOut).toMatch(/--status active/)
  })
})
