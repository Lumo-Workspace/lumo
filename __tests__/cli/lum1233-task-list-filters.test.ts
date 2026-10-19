/**
 * @jest-environment node
 *
 * LUM-1233 (2026-10-19 ruling): `task list` takes every `task search` filter
 * plus `--search` / `--exact`. A repeated flag ORs its values, different
 * flags AND; without `--assignee` it still lists only my tasks (the 1.126.0
 * request, byte for byte); `--assignee any` spans the workspace and
 * `--assignee none` is the unassigned set. `task search` is a tombstone whose
 * hint keeps the caller's filters (and adds `--assignee any`, its old scope).
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
    userId: 'user_me',
  })),
}))

import fs from 'fs'
import path from 'path'
import {
  assigneeScope,
  taskList,
  usesNewFilters,
} from '@/cli/src/commands/task-list'
import {
  findRemovedCommand,
  removedCommandLines,
  taskSearchReplacement,
} from '@/cli/src/lib/removed-commands'
import { classifyError } from '@/cli/src/lib/error-output'
import { EXIT_USAGE } from '@/cli/src/lib/exit-codes'

const grammar = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../scripts/cli-grammar/grammar.json'),
    'utf8'
  )
) as {
  commands: Record<
    string,
    {
      arguments: unknown[]
      flags: Record<string, { short: string | null; value: string }>
    }
  >
}

/** Whether `flag` takes a value on `path`, read from the shipped grammar. */
const takesValue = (p: string, flag: string): boolean => {
  const cmd = grammar.commands[p]
  if (!cmd) return ['--project', '--limit', '-n', '--cursor'].includes(flag)
  const f = Object.values(cmd.flags).find(
    x => (x as { long?: string }).long === flag || x.short === flag
  )
  return f ? f.value !== 'none' : flag === '--project'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const MEMBERS = {
  members: [
    {
      id: 'm1',
      name: 'Me Self',
      email: 'me@x.com',
      role: 'OWNER',
      actorId: 'act-me',
      clerkId: 'user_me',
    },
    {
      id: 'm2',
      name: 'Alice',
      email: 'alice@x.com',
      role: 'MEMBER',
      actorId: 'act-alice',
    },
  ],
  agentActors: [],
}

function taskRow(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `t${n}`,
    number: n,
    title: `Task ${n}`,
    status: 'TODO',
    priority: 'HIGH',
    teamIdentifier: 'LUM',
    project: { id: 'p1', name: 'lumo' },
    assigneeActorId: 'act-alice',
    dueDate: null,
    ...extra,
  }
}

let out: string
let err: string
let fetchMock: jest.Mock
/** The /api/tasks/me body; `truncated` absent = a server older than LUM-1233. */
let meBody: Record<string, unknown>

beforeEach(() => {
  out = ''
  err = ''
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    err += a.join(' ') + '\n'
  })
  meBody = {
    tasks: [taskRow(1)],
    total: 1,
    nextCursor: null,
    truncated: false,
  }
  fetchMock = jest.fn(async (url: string) => {
    const u = new URL(String(url))
    switch (u.pathname) {
      case '/api/tasks/me':
        return json(meBody)
      case '/api/workspaces/members':
        return json(MEMBERS)
      case '/api/tags':
        return json({
          tags: [
            { id: 't-bug', name: 'bug' },
            { id: 't-ui', name: 'ui' },
          ],
        })
      case '/api/projects':
        return json({
          projects: [{ id: 'p1', name: 'Lumo App', isIdea: false }],
        })
      case '/api/projects/p1/milestones':
        return json({
          milestones: [{ id: 'ms1', name: 'Beta', slug: 'beta' }],
        })
      case '/api/sprints/by-number':
        return json({
          sprint: { id: 'sp3', number: 3, name: 'S3', teamId: 'tm' },
        })
      default:
        throw new Error(`unexpected fetch ${u}`)
    }
  })
  global.fetch = fetchMock as unknown as typeof fetch
})
afterEach(() => jest.restoreAllMocks())

/** The query string `task list` sent to /api/tasks/me. */
function sent(): Record<string, string> {
  const call = fetchMock.mock.calls
    .map(c => new URL(String(c[0])))
    .find(u => u.pathname === '/api/tasks/me')
  if (!call) throw new Error('no /api/tasks/me request')
  return Object.fromEntries(call.searchParams)
}

describe('default: only my tasks, the 1.126.0 request unchanged', () => {
  it('no flags → GET /api/tasks/me?limit=50 and nothing else', async () => {
    meBody = { tasks: [taskRow(1)], total: 1, nextCursor: null }
    expect(await taskList({})).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://api.lumo.test/api/tasks/me?limit=50'
    )
    // The narrow table (no ASSIGNEE / DUE columns), as before.
    expect(out).toBe('LUM-1\tTODO\tHIGH\tlumo\tTask 1\n')
  })

  it('--status alone is still the old request (an older server handles it)', async () => {
    meBody = { tasks: [], total: 0, nextCursor: null }
    expect(await taskList({ status: ['todo'] })).toBeUndefined()
    expect(sent()).toEqual({ statuses: 'TODO', limit: '50' })
  })
})

describe('every filter is sent server-side', () => {
  it.each<[string, Record<string, unknown>, Record<string, string>]>([
    ['--status', { status: ['in_progress'] }, { statuses: 'IN_PROGRESS' }],
    ['--priority', { priority: ['urgent'] }, { priorities: 'URGENT' }],
    ['--tag', { tag: ['BUG'] }, { tagIds: 't-bug' }],
    [
      '--project (name or slug)',
      { project: 'lumo-app' },
      { projectName: 'Lumo App' },
    ],
    ['--milestone', { milestone: 'beta' }, { milestoneIds: 'ms1' }],
    ['--sprint', { sprint: '3' }, { sprintIds: 'sp3' }],
    [
      '--due-after',
      { dueAfter: '2026-09-01' },
      { dueAfter: new Date(2026, 8, 1).toISOString() },
    ],
    [
      '--due-before (inclusive day)',
      { dueBefore: '2026-09-30' },
      { dueBefore: new Date(2026, 9, 1).toISOString() },
    ],
    ['--search', { search: 'oauth' }, { q: 'oauth', match: 'fuzzy' }],
    [
      '--search --exact',
      { search: 'oauth', exact: true },
      { q: 'oauth', match: 'exact' },
    ],
    [
      '--assignee alice',
      { assignee: ['alice@x.com'] },
      { assigneeActorIds: 'act-alice' },
    ],
    ['--assignee any', { assignee: ['any'] }, { assignee: 'any' }],
    ['--assignee none', { assignee: ['none'] }, { unassigned: '1' }],
  ])('%s', async (_name, opts, params) => {
    expect(await taskList(opts)).toBeUndefined()
    expect(sent()).toEqual({ ...params, limit: '50' })
  })
})

describe('a repeated flag ORs, different flags AND', () => {
  it('repeats (and commas) collapse into one list per flag', async () => {
    await taskList({
      status: ['todo', 'in-progress,done'],
      priority: ['high', 'urgent'],
      tag: ['bug', 'ui'],
      assignee: ['alice@x.com', 'none'],
    })
    expect(sent()).toEqual({
      statuses: 'TODO,IN_PROGRESS,DONE',
      priorities: 'HIGH,URGENT',
      tagIds: 't-bug,t-ui',
      assigneeActorIds: 'act-alice',
      unassigned: '1',
      limit: '50',
    })
  })

  it('every flag at once lands in the same request', async () => {
    await taskList({
      assignee: ['any'],
      search: 'redirect bug',
      status: ['todo'],
      priority: ['high'],
      tag: ['bug'],
      project: 'Lumo App',
      milestone: 'beta',
      sprint: '3',
      dueBefore: '2026-09-30',
    })
    expect(sent()).toMatchObject({
      assignee: 'any',
      q: 'redirect bug',
      match: 'fuzzy',
      statuses: 'TODO',
      priorities: 'HIGH',
      tagIds: 't-bug',
      projectName: 'Lumo App',
      milestoneIds: 'ms1',
      sprintIds: 'sp3',
    })
  })
})

describe('assignee scope', () => {
  it('maps the --assignee values', () => {
    expect(assigneeScope([])).toEqual({ ok: true, scope: 'me' })
    expect(assigneeScope(['ANY'])).toEqual({ ok: true, scope: 'any' })
    expect(assigneeScope(['me', 'none'])).toEqual({
      ok: true,
      scope: 'refs',
      refs: ['me', 'none'],
    })
    expect(assigneeScope(['any', 'me']).ok).toBe(false)
  })

  it('--assignee any mixed with another value is a usage error, no request', async () => {
    expect(await taskList({ assignee: ['any', 'me'] })).toBe(EXIT_USAGE)
    expect(err).toMatch(/--assignee any already includes every assignee/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('--assignee any prints the wide table with the assignee name and due day', async () => {
    meBody = {
      tasks: [
        taskRow(1, { dueDate: new Date(2026, 8, 30).toISOString() }),
        taskRow(2, { assigneeActorId: null, priority: 'LOW' }),
      ],
      total: 2,
      nextCursor: null,
      truncated: false,
    }
    await taskList({ assignee: ['any'] })
    expect(out.split('\n')).toEqual([
      'LUM-1\tTODO\tHIGH\tlumo\tAlice\t2026-09-30\tTask 1',
      'LUM-2\tTODO\tLOW\tlumo\t-\t-\tTask 2',
      '',
    ])
  })
})

describe('--search / --exact', () => {
  it('--exact without --search is a usage error', async () => {
    expect(await taskList({ exact: true })).toBe(EXIT_USAGE)
    expect(err).toMatch(/--exact only works with --search/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a capped fuzzy search says so; --json carries truncated', async () => {
    meBody = {
      tasks: [taskRow(1)],
      total: 500,
      nextCursor: '1',
      truncated: true,
    }
    await taskList({ assignee: ['any'], search: 'serch', limit: '1' })
    expect(out).toContain('(result capped at 500 — narrow the filters)')
    expect(out).toContain(
      'Next page: lumo task list --assignee any --search serch --limit 1 --cursor 1'
    )
    out = ''
    await taskList({ assignee: ['any'], search: 'serch', json: true })
    expect(JSON.parse(out)).toMatchObject({ truncated: true, total: 500 })
  })
})

describe('a server older than these filters', () => {
  it('flags which queries need the new server', () => {
    expect(usesNewFilters({ statuses: ['TODO'], project: 'x' })).toBe(false)
    expect(usesNewFilters({ assignee: 'any' })).toBe(true)
    expect(usesNewFilters({ q: 'x' })).toBe(true)
  })

  it('a new filter answered without `truncated` is an error, never a wrong list', async () => {
    meBody = { tasks: [taskRow(1)], total: 1, nextCursor: null }
    expect(await taskList({ assignee: ['any'] })).toBe(1)
    expect(err).toMatch(/does not support these task list filters yet/)
    expect(out).toBe('')
  })
})

describe('task search is a tombstone naming the equivalent task list', () => {
  it.each<[string[], string]>([
    [
      ['task', 'search', 'foo', '--tag', 'bug'],
      'lumo task list --assignee any --search foo --tag bug',
    ],
    [['task', 'search'], 'lumo task list --assignee any'],
    [
      ['task', 'search', 'oauth', 'redirect'],
      "lumo task list --assignee any --search 'oauth redirect'",
    ],
    [
      ['task', 'search', '--assignee', 'none', '--status', 'todo'],
      'lumo task list --assignee none --status todo',
    ],
    [['task', 'search', 'x', '-a', 'me'], 'lumo task list --search x -a me'],
    [
      ['task', 'search', '-p', 'high', '-p', 'urgent'],
      'lumo task list --assignee any --priority high --priority urgent',
    ],
    [
      ['task', 'search', 'serch', '--exact', '--json'],
      'lumo task list --assignee any --search serch --exact --json',
    ],
    [['task', 'search', '--exact'], 'lumo task list --assignee any'],
    [
      [
        'task',
        'search',
        '--due-before',
        '2026-09-30',
        '--sprint',
        '3',
        '--team',
        'LUM',
        '--limit',
        '20',
      ],
      'lumo task list --assignee any --due-before 2026-09-30 --sprint 3 --team LUM --limit 20',
    ],
    [
      ['--project', 'lumo', 'task', 'search', 'x'],
      'lumo task list --assignee any --search x',
    ],
  ])('%j → %s', (argv, replacement) => {
    const hit = findRemovedCommand(argv, takesValue)
    expect(hit?.replacement).toBe(replacement)
    expect(hit?.help).toBe('lumo task list')
  })

  it('the replacement is a valid task list call (every flag is in the grammar)', () => {
    const r = taskSearchReplacement(['a'], ['--tag', 'bug', '-p', 'high'])
    for (const tok of r.split(' ').filter(t => t.startsWith('-')))
      expect(
        Object.values(grammar.commands['task list']!.flags).some(
          f => (f as { long?: string }).long === tok || f.short === tok
        )
      ).toBe(true)
  })

  it('fails as COMMAND_REMOVED (exit 2) and is gone from the grammar', () => {
    const hit = findRemovedCommand(['task', 'search', 'foo'], takesValue)!
    const [line] = removedCommandLines(hit)
    expect(line).toBe(
      'Error: lumo task search was removed. Use: lumo task list --assignee any --search foo'
    )
    expect(classifyError(2, line!.slice('Error: '.length))).toBe(
      'COMMAND_REMOVED'
    )
    expect(grammar.commands).not.toHaveProperty(['task search'])
    expect(
      findRemovedCommand(['task', 'list', '--search', 'x'], takesValue)
    ).toBeNull()
  })
})
