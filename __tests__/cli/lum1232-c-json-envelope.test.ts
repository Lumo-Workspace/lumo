/**
 * @jest-environment node
 *
 * LUM-1232 batch C: the one `--json` envelope (docs/cli-output-conventions.md
 * J-1–J-5, decision Q3) — helpers, the two wrapped bare arrays (`tag list`,
 * `task history`) plus `task template list`, the `task list` whitelist with
 * deprecated fields and `--fields`, and `inbox list`'s `total` / `nextCursor`.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    email: 'me@x.com',
  })),
}))

import {
  JSON_VERSION,
  detailEnvelope,
  listEnvelope,
  parseFieldList,
  pickFields,
  stringifyJson,
  stripInternalFields,
  withVersion,
} from '@/cli/src/lib/json-output'
import {
  TASK_LIST_DEPRECATED_FIELDS,
  TASK_LIST_FIELDS,
  taskList,
  taskListJson,
  taskListJsonRow,
  type ListedTask,
} from '@/cli/src/commands/task-list'
import { tagList } from '@/cli/src/commands/tag'
import { searchJson } from '@/cli/src/commands/task-search'
import { taskHistory } from '@/cli/src/commands/task-history'
import { INBOX_SERVER_CAP, inboxPage } from '@/cli/src/commands/inbox-list'
import { status } from '@/cli/src/commands/status'
import { taskTemplateList } from '@/cli/src/commands/task-template-list'
import { EXIT_USAGE } from '@/cli/src/lib/exit-codes'

let out: string
let err: string
const routes: Record<string, () => unknown> = {}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status })

beforeEach(() => {
  out = ''
  err = ''
  for (const k of Object.keys(routes)) delete routes[k]
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    err += a.map(String).join(' ') + '\n'
  })
  jest.spyOn(console, 'log').mockImplementation(() => {})
  global.fetch = jest.fn(async (url: string) => {
    const u = new URL(String(url))
    const h = routes[u.pathname]
    if (!h) throw new Error(`unexpected ${u.pathname}`)
    return h()
  }) as unknown as typeof fetch
})
afterEach(() => jest.restoreAllMocks())

function task(n: number, extra: Partial<ListedTask> = {}): ListedTask {
  return {
    id: `t${n}`,
    number: n,
    title: `Task ${n}`,
    status: 'TODO',
    priority: 'HIGH',
    teamIdentifier: 'LUM',
    project: { id: 'p', name: 'Lumo' },
    milestoneId: null,
    ...extra,
  } as ListedTask
}

describe('json-output helpers', () => {
  it('listEnvelope: version, plural noun, total defaults to count, nextCursor null', () => {
    expect(listEnvelope('tags', [1, 2])).toEqual({
      version: JSON_VERSION,
      tags: [1, 2],
      total: 2,
      nextCursor: null,
    })
    expect(
      listEnvelope('events', [], { total: null, nextCursor: '5' }, { x: 1 })
    ).toEqual({ version: 1, events: [], total: null, nextCursor: '5', x: 1 })
  })

  it('detailEnvelope puts the resource under a singular noun', () => {
    expect(detailEnvelope('task', { ref: 'LUM-1' }, { scans: [] })).toEqual({
      version: 1,
      task: { ref: 'LUM-1' },
      scans: [],
    })
  })

  it('withVersion only adds version, first, and keeps an existing one', () => {
    const body = withVersion({ a: 1, b: { c: 2 } })
    expect(Object.keys(body)).toEqual(['version', 'a', 'b'])
    expect(body).toEqual({ version: 1, a: 1, b: { c: 2 } })
    expect(withVersion({ version: 3, a: 1 })).toEqual({ version: 3, a: 1 })
  })

  it('stringifyJson is pretty-printed with a trailing newline', () => {
    expect(stringifyJson({ a: 1 })).toBe('{\n  "a": 1\n}\n')
  })

  it('stripInternalFields drops internal columns at any depth', () => {
    expect(
      stripInternalFields({
        id: 'x',
        workspaceId: 'w',
        order: 3,
        nested: [{ deletedByClerkId: 'c', claimSnapshot: {}, keep: 1 }],
      })
    ).toEqual({ id: 'x', nested: [{ keep: 1 }] })
  })

  it('stripInternalFields keeps user data under opaque keys untouched', () => {
    const content = { order: 1, workspaceId: 'mine', why: 'x' }
    expect(
      stripInternalFields({
        workspaceId: 'w',
        content,
        payload: { order: 2 },
        nested: { snapshot: [{ order: 3 }], order: 4 },
      })
    ).toEqual({
      content,
      payload: { order: 2 },
      nested: { snapshot: [{ order: 3 }] },
    })
  })

  it('pickFields keeps the asked order and turns a missing field into null', () => {
    expect(pickFields({ a: 1, b: 2, c: 3 }, ['c', 'a', 'z'])).toEqual({
      c: 3,
      a: 1,
      z: null,
    })
  })

  it('parseFieldList validates against the declared fields', () => {
    expect(parseFieldList(' ref, title ,,ref', ['ref', 'title'])).toEqual({
      ok: true,
      fields: ['ref', 'title'],
    })
    const bad = parseFieldList('ref,nope', ['ref', 'title'])
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.error).toMatch(
      /unknown field "nope".*Available: ref, title/
    )
    const empty = parseFieldList(' , ', ['ref'])
    expect(!empty.ok && empty.error).toMatch(/at least one field/)
  })
})

describe('task list --json: whitelist, deprecation, --fields', () => {
  const page = {
    items: [task(1, { workspaceId: 'w', order: 2 } as Partial<ListedTask>)],
    total: 9,
    offset: 0,
    nextCursor: '1',
  }

  it('adds ref first and keeps every server field (J-5 only add)', () => {
    const row = taskListJsonRow(page.items[0]!)
    expect(Object.keys(row)[0]).toBe('ref')
    expect(row.ref).toBe('LUM-1')
    expect(row).toMatchObject({ workspaceId: 'w', order: 2, id: 't1' })
  })

  it('bare --json: envelope + deprecatedFields; internal fields still emitted', () => {
    const body = taskListJson(page)
    expect(body).toMatchObject({ version: 1, total: 9, nextCursor: '1' })
    expect(body.deprecatedFields).toEqual([...TASK_LIST_DEPRECATED_FIELDS])
    expect(body.deprecatedFields).toEqual(
      expect.arrayContaining(['workspaceId', 'deletedByClerkId', 'order'])
    )
    expect((body.tasks as Array<Record<string, unknown>>)[0]).toMatchObject({
      workspaceId: 'w',
    })
  })

  it('the whitelist is the documented set and never overlaps the deprecated one', () => {
    expect([...TASK_LIST_FIELDS]).toEqual([
      'ref',
      'id',
      'title',
      'status',
      'priority',
      'project',
      'assignee',
      'milestone',
      'sprint',
      'tags',
      'dueDate',
      'blockedByOpenCount',
      'unblocksOpenCount',
      'createdAt',
      'updatedAt',
    ])
    for (const f of TASK_LIST_DEPRECATED_FIELDS) {
      expect(TASK_LIST_FIELDS as readonly string[]).not.toContain(f)
    }
  })

  it('--fields prints only the selected fields, absent ones as null', async () => {
    routes['/api/tasks/me'] = () =>
      json({ tasks: [task(7)], total: 1, nextCursor: null })
    expect(
      await taskList({ json: true, fields: 'ref,status,dueDate' })
    ).toBeUndefined()
    const body = JSON.parse(out)
    expect(body).toEqual({
      version: 1,
      tasks: [{ ref: 'LUM-7', status: 'TODO', dueDate: null }],
      total: 1,
      nextCursor: null,
    })
  })

  it('--fields without --json is a usage error (exit 2), no request sent', async () => {
    expect(await taskList({ fields: 'ref' })).toBe(EXIT_USAGE)
    expect(err).toMatch(/--fields only works with --json/)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('an unknown --fields name is a usage error listing the valid ones', async () => {
    expect(await taskList({ json: true, fields: 'ref,workspaceId' })).toBe(
      EXIT_USAGE
    )
    expect(err).toMatch(/unknown field "workspaceId"/)
    expect(err).toMatch(/Available: ref, id, title/)
    expect(out).toBe('')
  })
})

describe('wrapped bare arrays', () => {
  it('tag list --json → { version, tags, total, nextCursor } with every tag field', async () => {
    const tag = {
      id: 'g1',
      name: 'beta',
      color: '#ff0000',
      taskCount: 2,
      documentCount: 0,
      createdAt: '2026-10-01T00:00:00.000Z',
      workspaceId: 'w',
    }
    routes['/api/tags'] = () => json({ tags: [{ ...tag, name: 'zeta' }, tag] })
    await tagList({ json: true })
    const body = JSON.parse(out)
    expect(Array.isArray(body)).toBe(false)
    expect(body).toEqual({
      version: 1,
      tags: [tag, { ...tag, name: 'zeta' }],
      total: 2,
      nextCursor: null,
    })
  })

  it('task history --json → { version, entries, total, nextCursor }', async () => {
    routes['/api/tasks/resolve/LUM-9'] = () =>
      json({ id: 't9', identifier: 'LUM-9' })
    const act = (id: string) => ({
      id,
      kind: 'activity',
      type: 'STATUS_CHANGED',
      createdAt: '2026-09-23T10:00:00Z',
      actorId: 'a',
      payload: {},
    })
    routes['/api/tasks/t9/timeline'] = () =>
      json({
        items: [act('a1'), act('a2'), act('a3')],
        hasMore: false,
        nextCursor: null,
      })
    expect(await taskHistory('LUM-9', { limit: '2', json: true })).toBe(
      undefined
    )
    const body = JSON.parse(out)
    expect(body.version).toBe(1)
    expect(body.entries.map((e: { id: string }) => e.id)).toEqual(['a2', 'a3'])
    expect(body.total).toBe(3)
    expect(body.nextCursor).toBe('2')
    expect(body.entries[0]).toEqual(act('a2'))
  })

  it('task template list --json → { version, templates, total, nextCursor }', async () => {
    routes['/api/task-templates'] = () =>
      json({
        templates: [
          {
            key: 'k',
            name: 'K',
            description: null,
            isSystem: true,
            content: '#',
          },
        ],
      })
    await taskTemplateList({ json: true })
    expect(JSON.parse(out)).toEqual({
      version: 1,
      templates: [
        {
          key: 'k',
          name: 'K',
          description: null,
          isSystem: true,
          content: '#',
        },
      ],
      total: 1,
      nextCursor: null,
    })
  })
})

describe('status --inbox --json', () => {
  it('keeps notifications + unreadCount and adds version, total, nextCursor', async () => {
    routes['/api/notifications'] = () =>
      json({ notifications: [], unreadCount: 0 })
    await status({ inbox: true, json: true })
    expect(JSON.parse(out)).toEqual({
      version: 1,
      notifications: [],
      unreadCount: 0,
      total: 0,
      nextCursor: null,
    })
  })

  it('total is null (unknown) when the server cap was reached', () => {
    const rows = (n: number) =>
      ({
        notifications: Array.from({ length: n }, () => ({})),
        unreadCount: 0,
      }) as unknown as Parameters<typeof inboxPage>[0]
    expect(inboxPage(rows(3))).toEqual({ total: 3, nextCursor: null })
    expect(inboxPage(rows(INBOX_SERVER_CAP))).toEqual({
      total: null,
      nextCursor: null,
    })
  })
})

describe('task search --json', () => {
  it('adds ref first, keeps every field, and names the deprecated ones', () => {
    const row = {
      number: 4,
      title: 't',
      status: 'TODO',
      priority: 'LOW',
      teamIdentifier: 'LUM',
      dueDate: null,
      assigneeActorId: null,
      workspaceId: 'w',
    }
    const body = searchJson([row], true, { total: 1, nextCursor: null })
    expect(body).toMatchObject({
      version: 1,
      truncated: true,
      total: 1,
      nextCursor: null,
    })
    const [t] = body.tasks as Array<Record<string, unknown>>
    expect(Object.keys(t!)[0]).toBe('ref')
    expect(t).toEqual({ ref: 'LUM-4', ...row })
    expect(body.deprecatedFields).toEqual([...TASK_LIST_DEPRECATED_FIELDS])
  })
})

describe('grammar: --fields and the tag-flag rule in --help', () => {
  const grammar = require('../../scripts/cli-grammar/grammar.json') as {
    commands: Record<
      string,
      { flags: Record<string, { description?: string; takesValue?: boolean }> }
    >
  }

  it('task list declares --fields', () => {
    expect(grammar.commands['task list']!.flags['--fields']).toBeDefined()
  })

  it.each(['task update', 'doc update'])(
    '%s --tag / --tag-id say they cannot be combined with --add-tag* / --remove-tag*',
    cmd => {
      for (const f of ['--tag', '--tag-id']) {
        expect(grammar.commands[cmd]!.flags[f]!.description).toMatch(
          /Cannot be combined with --add-tag\* \/ --remove-tag\*/
        )
      }
    }
  )
})
