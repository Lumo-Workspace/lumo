/**
 * @jest-environment node
 *
 * LUM-821 P2 (CLI): task delete (exit-4 envelope), task history rendering,
 * project create/update.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
}))

import { describeTaskDelete, taskDelete } from '@/cli/src/commands/task-delete'
import {
  describeActivity,
  formatHistory,
  taskHistory,
} from '@/cli/src/commands/task-history'
import { projectCreate, projectUpdate } from '@/cli/src/commands/project-manage'
import { EXIT_CONFIRMATION_REQUIRED } from '@/cli/src/lib/confirmation'
import { localDayStart } from '@/cli/src/lib/local-day'

let out: string
let fetchMock: jest.Mock
const routes: Record<string, (init?: RequestInit) => unknown> = {}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status })

beforeEach(() => {
  out = ''
  for (const k of Object.keys(routes)) delete routes[k]
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  routes['GET /api/workspaces/members'] = () =>
    json({
      members: [
        {
          id: 'm1',
          name: 'Alice',
          email: 'me@x.com',
          role: 'OWNER',
          actorId: 'act-a',
        },
      ],
      agentActors: [
        { actorId: 'act-bot', name: 'Claude Code', type: 'CODING' },
      ],
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

describe('task delete', () => {
  beforeEach(() => {
    routes['GET /api/tasks/by-identifier/LUM-9'] = () =>
      json({
        task: {
          identifier: 'LUM-9',
          title: 'Old spike',
          status: 'TODO',
          pullRequests: [{ number: 42 }],
        },
      })
    routes['DELETE /api/tasks/by-identifier/LUM-9'] = () =>
      json({ deleted: { identifier: 'LUM-9', title: 'Old spike' } })
  })

  it('without --confirm: exit 4, envelope names the task and its linked PRs, no DELETE', async () => {
    expect(await taskDelete('LUM-9', {})).toBe(EXIT_CONFIRMATION_REQUIRED)
    expect(method('DELETE')).toHaveLength(0)
    const env = JSON.parse(out)
    expect(env.changes[0]).toContain(
      'Will move LUM-9 "Old spike" (TODO) to the trash'
    )
    expect(env.changes.join('\n')).toContain('Linked PR(s) #42 stay on GitHub')
    expect(env.changes.join('\n')).not.toMatch(/subtask/)
    expect(env.confirmCommand).toMatch(/ --confirm$/)
  })

  it('--confirm sends the DELETE', async () => {
    expect(await taskDelete('LUM-9', { confirm: true })).toBeUndefined()
    expect(method('DELETE')).toHaveLength(1)
    expect(out).toContain('Moved LUM-9 "Old spike" to the trash')
  })

  it('describeTaskDelete omits the PR line when there are none', () => {
    const lines = describeTaskDelete({
      identifier: 'LUM-1',
      title: 't',
      status: 'DONE',
    })
    expect(lines.join('\n')).not.toMatch(/subtask|PR\(s\)/)
  })
})

describe('task history', () => {
  const names = new Map([
    ['act-a', 'Alice'],
    ['act-bot', 'Claude Code'],
  ])
  it('describes each recorded field change', () => {
    const a = (type: string, payload: Record<string, unknown>) => ({
      id: 'x',
      kind: 'activity' as const,
      type,
      createdAt: '2026-09-23T00:00:00Z',
      payload,
    })
    expect(
      describeActivity(
        a('STATUS_CHANGED', { from: 'TODO', to: 'IN_PROGRESS' }),
        names
      )
    ).toBe('status TODO → IN_PROGRESS')
    expect(
      describeActivity(
        a('ASSIGNEE_CHANGED', { fromActorId: null, toActorId: 'act-a' }),
        names
      )
    ).toBe('assignee - → Alice')
    expect(
      describeActivity(
        a('TAGS_CHANGED', { added: ['bug'], removed: ['ux'] }),
        names
      )
    ).toBe('tags +bug -ux')
    expect(
      describeActivity(
        a('DUE_DATE_CHANGED', { from: null, to: localDayStart('2026-09-30') }),
        names
      )
    ).toBe('due - → 2026-09-30')
    expect(describeActivity(a('SOMETHING_NEW', {}), names)).toBe(
      'something new'
    )
  })

  it('walks the paged timeline, keeps only activity, prints the last N oldest-first', async () => {
    const act = (id: string, type: string, payload: object) => ({
      id,
      kind: 'activity',
      type,
      createdAt: '2026-09-23T10:00:00Z',
      actorId: 'act-bot',
      payload,
    })
    routes['GET /api/tasks/resolve/LUM-9'] = () =>
      json({ id: 't9', identifier: 'LUM-9' })
    let page = 0
    routes['GET /api/tasks/t9/timeline'] = () => {
      page++
      return page === 1
        ? json({
            items: [
              act('a1', 'PRIORITY_CHANGED', { from: 'LOW', to: 'HIGH' }),
              { id: 'c1', kind: 'comment', createdAt: '2026-09-23T10:00:00Z' },
            ],
            hasMore: true,
            nextCursor: '{"c":1}',
          })
        : json({
            items: [act('a2', 'STATUS_CHANGED', { from: 'TODO', to: 'DONE' })],
            hasMore: false,
            nextCursor: null,
          })
    }
    expect(await taskHistory('LUM-9', { limit: '1' })).toBeUndefined()
    expect(page).toBe(2)
    expect(
      String(
        fetchMock.mock.calls.find(c => String(c[0]).includes('cursor='))![0]
      )
    ).toContain(encodeURIComponent('{"c":1}'))
    expect(out).toContain('LUM-9 history (oldest first)')
    expect(out).toMatch(/Claude Code {2}status TODO → DONE/)
    expect(out).not.toContain('priority LOW')
    // LUM-1093: the hidden-entries note is now the paging footer.
    expect(out).toContain('Showing 2-2 of 2.')
    expect(out).toContain(
      'Hint: earlier entries with `lumo task history LUM-9 --limit 1 --cursor 1`'
    )
  })

  it('formatHistory of nothing reads "No history."', () => {
    expect(formatHistory([], names)).toBe('No history.')
  })
})

describe('project create / update', () => {
  it('create posts the name + description', async () => {
    routes['POST /api/projects'] = () =>
      json({ project: { id: 'p1', name: 'API' } }, 201)
    expect(
      await projectCreate('API', { description: 'Backend' })
    ).toBeUndefined()
    expect(JSON.parse(String(method('POST')[0]![1].body))).toEqual({
      name: 'API',
      description: 'Backend',
    })
  })

  it('update resolves the project + owner (actor id) and PATCHes', async () => {
    routes['GET /api/projects'] = () =>
      json({ projects: [{ id: 'p1', name: 'API' }] })
    routes['PATCH /api/projects/p1'] = () =>
      json({ project: { id: 'p1', name: 'API v2' } })
    expect(
      await projectUpdate('api', {
        name: 'API v2',
        owner: 'me',
        description: '',
      })
    ).toBeUndefined()
    expect(JSON.parse(String(method('PATCH')[0]![1].body))).toEqual({
      name: 'API v2',
      description: null,
      ownerId: 'act-a',
    })
  })

  it('update with no fields fails before any network call', async () => {
    expect(await projectUpdate('api', {})).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
