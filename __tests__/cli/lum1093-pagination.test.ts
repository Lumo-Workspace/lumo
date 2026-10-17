/**
 * @jest-environment node
 *
 * LUM-1093: one paging contract for CLI lists — `--limit` (default 50) +
 * `--cursor`, a fixed "Showing X-Y of N." footer with the next-page command
 * when a page is not the whole result, and `total` / `nextCursor` in --json.
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

import {
  DEFAULT_PAGE_SIZE,
  buildCommand,
  pageFooter,
  paginate,
  parsePageArgs,
} from '@/cli/src/lib/pagination'
import {
  buildTaskListPath,
  pageFromResponse,
  taskList,
} from '@/cli/src/commands/task-list'
import { searchCommand, taskSearch } from '@/cli/src/commands/task-search'
import { milestoneList } from '@/cli/src/commands/milestone-list'
import { docList, formatDocListRowsAsTree } from '@/cli/src/commands/doc-list'
import {
  commentPageArgs,
  formatCommentPage,
  type CommentNode,
} from '@/cli/src/commands/task-comment-list'
import {
  historyPage,
  type ActivityEntry,
} from '@/cli/src/commands/task-history'
import { formatProjectList } from '@/cli/src/commands/project-list'
import { formatShareListRows } from '@/cli/src/commands/doc-share-list'

const FOOTER = /^Showing (\d+)-(\d+) of (\d+)\.$/m
const NEXT = /^Next page: (lumo .*--cursor (\d+))$/m

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('parsePageArgs', () => {
  it('defaults to 50 rows from the start', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(50)
    expect(parsePageArgs(undefined, undefined)).toEqual({
      ok: true,
      limit: 50,
      offset: 0,
    })
  })

  it('reads --limit and --cursor', () => {
    expect(parsePageArgs('10', '30')).toEqual({
      ok: true,
      limit: 10,
      offset: 30,
    })
  })

  it('rejects a bad --limit or --cursor', () => {
    expect(parsePageArgs('0', undefined).ok).toBe(false)
    expect(parsePageArgs('abc', undefined).ok).toBe(false)
    expect(parsePageArgs('501', undefined).ok).toBe(false)
    expect(parsePageArgs(undefined, 'xyz').ok).toBe(false)
    // Same bound as the server's cursor schema (at most 9 digits).
    expect(parsePageArgs(undefined, '1234567890').ok).toBe(false)
    expect(parsePageArgs(undefined, '123456789').ok).toBe(true)
  })
})

describe('paginate + pageFooter', () => {
  const all = Array.from({ length: 120 }, (_, i) => i)

  it('prints no footer when the page is the whole result', () => {
    const p = paginate(all.slice(0, 10), { limit: 50, offset: 0 })
    expect(p.nextCursor).toBeNull()
    expect(pageFooter({ ...p, shown: p.items.length }, 'lumo x')).toEqual([])
  })

  it('prints "Showing X-Y of N." and the next-page command when truncated', () => {
    const p = paginate(all, { limit: 50, offset: 0 })
    expect(p.items).toHaveLength(50)
    expect(p.nextCursor).toBe('50')
    expect(
      pageFooter({ ...p, shown: p.items.length }, 'lumo task list')
    ).toEqual(['Showing 1-50 of 120.', 'Next page: lumo task list --cursor 50'])
  })

  it('last page: range only, no next-page command', () => {
    const p = paginate(all, { limit: 50, offset: 100 })
    expect(p.items).toHaveLength(20)
    expect(p.nextCursor).toBeNull()
    expect(
      pageFooter({ ...p, shown: p.items.length }, 'lumo task list')
    ).toEqual(['Showing 101-120 of 120.'])
  })
})

describe('buildCommand', () => {
  it('drops empty flags, repeats arrays and shell-quotes values', () => {
    expect(
      buildCommand('task search', [
        ['--status', ['todo', 'done']],
        ['--project', 'My Proj'],
        ['--exact', true],
        ['--tag', undefined],
        ['--all', false],
      ])
    ).toBe(
      "lumo task search --status todo --status done --project 'My Proj' --exact"
    )
  })

  it('strips control characters from values', () => {
    expect(buildCommand('x', [['--a', 'b\x1b[31mc']])).not.toMatch(/\x1b/)
  })
})

/** Fake GET /api/tasks/me that pages a 120-task list server-side. */
function meServer(total = 120) {
  const tasks = Array.from({ length: total }, (_, i) => ({
    id: `t${i + 1}`,
    number: i + 1,
    title: `Task ${i + 1}`,
    status: 'TODO',
    priority: 'LOW',
    teamIdentifier: 'LUM',
    project: { id: 'p', name: 'lumo' },
  }))
  return jest.fn(async (url: string) => {
    const u = new URL(String(url))
    if (u.pathname !== '/api/tasks/me') throw new Error(`unexpected ${u}`)
    const limit = Number(u.searchParams.get('limit'))
    const offset = Number(u.searchParams.get('cursor') ?? 0)
    const page = tasks.slice(offset, offset + limit)
    return json({
      tasks: page,
      myTasksViewId: 'v',
      total: tasks.length,
      nextCursor:
        offset + page.length < tasks.length
          ? String(offset + page.length)
          : null,
    })
  })
}

describe('task list paging', () => {
  let out: string
  beforeEach(() => {
    out = ''
    jest.spyOn(process.stdout, 'write').mockImplementation(s => {
      out += String(s)
      return true
    })
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  it('sends filters + page server-side', () => {
    const u = new URL(
      `http://x${buildTaskListPath(
        { status: 'TODO', project: 'lumo', milestoneId: 'm1' },
        { limit: 50, offset: 50 }
      )}`
    )
    expect(Object.fromEntries(u.searchParams)).toEqual({
      statuses: 'TODO',
      projectName: 'lumo',
      milestoneIds: 'm1',
      limit: '50',
      cursor: '50',
    })
  })

  it('first page: 50 rows + footer; the printed command fetches page 2', async () => {
    const fetchMock = meServer()
    global.fetch = fetchMock as unknown as typeof fetch
    expect(await taskList({ status: 'todo' })).toBeUndefined()
    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get('limit')).toBe(
      '50'
    )
    const rows = out.split('\n').filter(l => /^LUM-\d+/.test(l))
    expect(rows).toHaveLength(50)
    expect(out).toMatch(FOOTER)
    expect(FOOTER.exec(out)!.slice(1)).toEqual(['1', '50', '120'])
    const next = NEXT.exec(out)!
    expect(next[1]).toBe('lumo task list --status todo --cursor 50')

    // Run the printed command: page 2 holds LUM-51..100.
    out = ''
    expect(await taskList({ status: 'todo', cursor: next[2]! })).toBeUndefined()
    expect(
      new URL(fetchMock.mock.calls[1]![0]).searchParams.get('cursor')
    ).toBe('50')
    const page2 = out.split('\n').filter(l => /^LUM-\d+/.test(l))
    expect(page2[0]).toMatch(/^LUM-51\s/)
    expect(page2[49]).toMatch(/^LUM-100\s/)
    expect(FOOTER.exec(out)!.slice(1)).toEqual(['51', '100', '120'])
    expect(NEXT.exec(out)![2]).toBe('100')
  })

  it('--json carries total and nextCursor', async () => {
    global.fetch = meServer() as unknown as typeof fetch
    await taskList({ limit: '10', json: true })
    const body = JSON.parse(out)
    expect(body.tasks).toHaveLength(10)
    expect(body.total).toBe(120)
    expect(body.nextCursor).toBe('10')
  })

  it('short list: no footer (output unchanged)', async () => {
    global.fetch = meServer(3) as unknown as typeof fetch
    await taskList({})
    expect(out).not.toMatch(/Showing/)
  })

  it('an older server without paging is filtered and paged client-side', () => {
    const tasks = Array.from({ length: 70 }, (_, i) => ({
      id: `t${i}`,
      number: i,
      title: 't',
      status: i % 2 ? 'DONE' : 'TODO',
      priority: 'LOW',
      teamIdentifier: 'LUM',
      project: { id: 'p', name: 'Lumo' },
    }))
    const page = pageFromResponse(
      { tasks },
      { status: 'TODO', project: 'lumo' },
      { limit: 20, offset: 0 }
    )
    expect(page.total).toBe(35)
    expect(page.items).toHaveLength(20)
    expect(page.nextCursor).toBe('20')
  })
})

describe('task search paging', () => {
  let out: string
  let fetchMock: jest.Mock
  beforeEach(() => {
    out = ''
    jest.spyOn(process.stdout, 'write').mockImplementation(s => {
      out += String(s)
      return true
    })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock = jest.fn(async (url: string) => {
      const u = new URL(String(url))
      if (u.pathname === '/api/workspaces/members') {
        return json({ members: [], agentActors: [] })
      }
      if (u.pathname === '/api/tasks/workspace') {
        const limit = Number(u.searchParams.get('limit'))
        const offset = Number(u.searchParams.get('cursor') ?? 0)
        const total = 75
        const n = Math.min(limit, total - offset)
        return json({
          tasks: Array.from({ length: n }, (_, i) => ({
            number: offset + i + 1,
            title: 'x',
            status: 'TODO',
            priority: 'LOW',
            teamIdentifier: 'LUM',
            dueDate: null,
            assigneeActorId: null,
            project: null,
          })),
          total,
          nextCursor: offset + n < total ? String(offset + n) : null,
        })
      }
      throw new Error(`unexpected ${u}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch
  })
  afterEach(() => jest.restoreAllMocks())

  it('pages server-side and prints the next-page command with the query', async () => {
    await taskSearch('oauth bug', { status: ['todo'] })
    const call = fetchMock.mock.calls
      .map(c => new URL(String(c[0])))
      .find(u => u.pathname === '/api/tasks/workspace')!
    expect(call.searchParams.get('limit')).toBe('50')
    expect(call.searchParams.get('cursor')).toBeNull()
    expect(FOOTER.exec(out)!.slice(1)).toEqual(['1', '50', '75'])
    expect(NEXT.exec(out)![1]).toBe(
      "lumo task search 'oauth bug' --status todo --cursor 50"
    )
    expect(out).not.toMatch(/result capped/)
  })

  it('--cursor fetches the next page; last page has no next command', async () => {
    await taskSearch(undefined, { cursor: '50' })
    const call = fetchMock.mock.calls
      .map(c => new URL(String(c[0])))
      .find(u => u.pathname === '/api/tasks/workspace')!
    expect(call.searchParams.get('cursor')).toBe('50')
    expect(FOOTER.exec(out)!.slice(1)).toEqual(['51', '75', '75'])
    expect(out).not.toMatch(NEXT)
  })

  it('--json adds total and nextCursor (truncated kept)', async () => {
    await taskSearch(undefined, { json: true, limit: '5' })
    const body = JSON.parse(out)
    expect(body).toMatchObject({ total: 75, nextCursor: '5', truncated: false })
    expect(body.tasks).toHaveLength(5)
  })

  it('a capped fuzzy result still says so on the paged path (text + --json)', async () => {
    global.fetch = jest.fn(async (url: string) => {
      const u = new URL(String(url))
      if (u.pathname === '/api/workspaces/members') {
        return json({ members: [], agentActors: [] })
      }
      return json({
        tasks: Array.from({ length: 50 }, (_, i) => ({
          number: i + 1,
          title: 'x',
          status: 'TODO',
          priority: 'LOW',
          teamIdentifier: 'LUM',
          dueDate: null,
          assigneeActorId: null,
          project: null,
        })),
        total: 500,
        nextCursor: '50',
        truncated: true,
      })
    }) as unknown as typeof fetch
    await taskSearch('serch', {})
    expect(FOOTER.exec(out)!.slice(1)).toEqual(['1', '50', '500'])
    expect(out).toContain('(result capped at 500 — narrow the filters)')
    out = ''
    await taskSearch('serch', { json: true })
    expect(JSON.parse(out)).toMatchObject({
      truncated: true,
      total: 500,
      nextCursor: '50',
    })
  })

  it('searchCommand keeps every filter', () => {
    expect(
      searchCommand(undefined, {
        assignee: ['me'],
        tag: ['bug'],
        project: 'lumo',
        limit: '20',
        exact: true,
      })
    ).toBe(
      'lumo task search --assignee me --tag bug --project lumo --limit 20 --exact'
    )
  })
})

describe('milestone list / doc list paging (client-side)', () => {
  let out: string
  beforeEach(() => {
    out = ''
    jest.spyOn(process.stdout, 'write').mockImplementation(s => {
      out += String(s)
      return true
    })
    jest.spyOn(console, 'log').mockImplementation((s: unknown) => {
      out += `${String(s)}\n`
    })
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  it('milestone list pages 50 at a time with a footer', async () => {
    global.fetch = jest.fn(async (url: string) => {
      const u = new URL(String(url))
      if (u.pathname === '/api/projects') {
        return json({ projects: [{ id: 'p1', name: 'lumo' }] })
      }
      return json({
        milestones: Array.from({ length: 60 }, (_, i) => ({
          id: `m${i}`,
          name: `M${i + 1}`,
          completedAt: null,
          targetDate: null,
          createdAt: '2026-01-01',
          archivedAt: null,
        })),
      })
    }) as unknown as typeof fetch
    expect(await milestoneList({ project: 'lumo' })).toBeUndefined()
    expect(out.split('\n').filter(l => /M\d+$/.test(l))).toHaveLength(50)
    expect(FOOTER.exec(out)!.slice(1)).toEqual(['1', '50', '60'])
    expect(NEXT.exec(out)![1]).toBe(
      'lumo milestone list --project lumo --cursor 50'
    )
    out = ''
    await milestoneList({ project: 'lumo', cursor: '50' })
    expect(out.split('\n').filter(l => /M\d+$/.test(l))).toHaveLength(10)
    expect(FOOTER.exec(out)!.slice(1)).toEqual(['51', '60', '60'])
  })

  it('doc list pages with a footer and --limit', async () => {
    global.fetch = jest.fn(async () =>
      json({
        documents: Array.from({ length: 30 }, (_, i) => ({
          id: `d${i}`,
          title: `Doc ${i}`,
          visibility: 'WORKSPACE',
          project: null,
          parentId: null,
          sortOrder: i,
        })),
      })
    ) as unknown as typeof fetch
    await docList({ limit: '10', scope: 'workspace' })
    expect(out.split('\n').filter(l => /^d\d+/.test(l))).toHaveLength(10)
    expect(FOOTER.exec(out)!.slice(1)).toEqual(['1', '10', '30'])
    expect(NEXT.exec(out)![1]).toBe(
      'lumo doc list --scope workspace --limit 10 --cursor 10'
    )
  })

  it('doc list --tree keeps real depth on a later page', () => {
    const rows = [
      {
        id: 'a',
        title: 'A',
        visibility: 'WORKSPACE' as const,
        project: null,
        parentId: null,
        sortOrder: 0,
      },
      {
        id: 'b',
        title: 'B',
        visibility: 'WORKSPACE' as const,
        project: null,
        parentId: 'a',
        sortOrder: 0,
      },
    ]
    const lines = formatDocListRowsAsTree([rows[1]!], { tty: false }, rows)
    expect(lines[0]).toMatch(/^b\s+WORKSPACE\s+-\s+ {2}B$/)
  })
})

describe('task comments list paging', () => {
  const threads: CommentNode[] = Array.from({ length: 55 }, (_, i) => ({
    id: `c${String(i).padStart(8, '0')}`,
    authorActorId: 'a',
    body: `<p>comment ${i + 1}</p>`,
    createdAt: '2026-10-01',
  }))

  it('pages top-level threads 50 at a time, footer outside the fence', () => {
    const r = commentPageArgs({})
    expect(r).toEqual({ ok: true, page: { limit: 50, offset: 0 } })
    const out = formatCommentPage(threads, r.ok ? r.page : null, 'LUM-1', {
      full: true,
    })
    expect(out).toContain('comment 50')
    expect(out).not.toContain('comment 51')
    expect(FOOTER.exec(out)!.slice(1)).toEqual(['1', '50', '55'])
    expect(NEXT.exec(out)![1]).toBe(
      'lumo task comments list LUM-1 --full --cursor 50'
    )
    expect(out.lastIndexOf('</untrusted-linked-context>')).toBeLessThan(
      out.indexOf('Showing')
    )
  })

  it('--full alone still prints every comment (no paging)', () => {
    expect(commentPageArgs({ full: true })).toEqual({ ok: true, page: null })
    const out = formatCommentPage(threads, null, 'LUM-1', { full: true })
    expect(out).toContain('comment 55')
    expect(out).not.toMatch(/Showing/)
  })
})

describe('task history paging (newest page first)', () => {
  const all: ActivityEntry[] = Array.from({ length: 120 }, (_, i) => ({
    id: `a${i}`,
    kind: 'activity',
    type: 'CREATED',
    createdAt: '2026-10-01T00:00:00Z',
  }))

  it('first page is the latest 50, cursor walks to earlier entries', () => {
    const p1 = historyPage(all, { limit: 50, offset: 0 })
    expect(p1.items[0]!.id).toBe('a70')
    expect(p1.items[49]!.id).toBe('a119')
    expect(p1.nextCursor).toBe('50')
    expect(
      pageFooter(
        { ...p1, shown: 50 },
        'lumo task history LUM-1',
        'earlier entries'
      )
    ).toEqual([
      'Showing 71-120 of 120.',
      'Next page: lumo task history LUM-1 --cursor 50',
    ])
    const p3 = historyPage(all, { limit: 50, offset: 100 })
    expect(p3.items.map(a => a.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `a${i}`)
    )
    expect(p3.nextCursor).toBeNull()
  })
})

describe('project list / doc share-list use the shared table (LUM-1089)', () => {
  it('project list: headerless off a TTY, header on a TTY', () => {
    const projects = [
      { id: 'p1', name: 'My Project' },
      { id: 'p2', name: 'idea', isIdea: true },
    ]
    expect(formatProjectList(projects, { tty: false, color: false })).toBe(
      'my-project\tMy Project'
    )
    const tty = formatProjectList(projects, {
      tty: true,
      color: false,
      width: 80,
    }).split('\n')
    expect(tty[0]).toMatch(/^SLUG\s+NAME$/)
    expect(tty[1]).toBe('my-project  My Project')
  })

  it('doc share-list: same column order, header only on a TTY', () => {
    const rows = [
      { displayName: 'Alice', role: 'EDITOR' },
      { displayName: 'Bob Wong', role: 'VIEWER' },
    ]
    expect(formatShareListRows(rows, { tty: false, color: false })).toEqual([
      'Alice\tEDITOR',
      'Bob Wong\tVIEWER',
    ])
    expect(
      formatShareListRows(rows, { tty: true, color: false, width: 80 })[0]
    ).toMatch(/^NAME\s+ROLE$/)
  })
})
