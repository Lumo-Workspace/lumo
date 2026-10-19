/**
 * @jest-environment node
 *
 * LUM-1233 follow-up — `lumo status` / `status --inbox` show unread
 * notifications only (server-side `unread=1`); `--all` brings the read ones
 * back in today's shape; a server that ignores `unread=1` is filtered locally.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

import {
  formatInbox,
  INBOX_SERVER_CAP,
  inboxView,
  type InboxNotification,
  type InboxResponse,
} from '@/cli/src/commands/inbox-list'
import {
  inboxFilter,
  inboxPath,
  status,
  statusUsageError,
} from '@/cli/src/commands/status'

const row = (
  id: string,
  read: boolean,
  title = `Task ${id}`
): InboxNotification => ({
  id,
  type: 'TASK_ASSIGNED',
  read,
  requiresAction: false,
  actionTakenAt: null,
  createdAt: '2026-10-16T09:00:00.000Z',
  actor: { name: 'Alice Chen' },
  task: {
    title,
    number: Number(id.replace(/\D/g, '')) || 1,
    teamIdentifier: 'LUM',
  },
  sprint: null,
  project: null,
  milestone: null,
  document: null,
  commentPreview: null,
})

const UNREAD = row('n1', false, 'Fresh thing')
const READ = row('n2', true, 'Old read thing')

let out: string
let err: string
let urls: string[]
/** Response by full path + query; `/api/notifications` alone is the old shape. */
let routes: Record<string, unknown>

beforeEach(() => {
  out = ''
  err = ''
  urls = []
  process.env.LUMO_NO_HINTS = '1'
  routes = {
    '/api/priorities': { current: null, history: [] },
    '/api/drafts': { drafts: [] },
    '/api/me/active-sprints': { sprintIds: [] },
    '/api/tasks/me': { tasks: [] },
    // A current server: unread=1 → only unread rows.
    '/api/notifications?unread=1': { notifications: [UNREAD], unreadCount: 1 },
    '/api/notifications': { notifications: [UNREAD, READ], unreadCount: 1 },
  }
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'log').mockImplementation((...a) => {
    out += a.join(' ') + '\n'
  })
  jest.spyOn(console, 'error').mockImplementation((...a) => {
    err += a.join(' ') + '\n'
  })
  global.fetch = jest.fn(async (url: string) => {
    const u = new URL(url)
    const key = u.pathname + u.search
    urls.push(key)
    const body = routes[key]
    if (body === undefined)
      return { ok: false, status: 404, json: async () => ({ error: 'nope' }) }
    return { ok: true, status: 200, json: async () => body }
  }) as unknown as typeof fetch
})
afterEach(() => {
  delete process.env.LUMO_NO_HINTS
  jest.restoreAllMocks()
})

describe('flags', () => {
  it('unread by default, all with --all; the path follows', () => {
    expect(inboxFilter({})).toBe('unread')
    expect(inboxFilter({ all: true })).toBe('all')
    expect(inboxPath('unread')).toBe('/api/notifications?unread=1')
    expect(inboxPath('all')).toBe('/api/notifications')
  })

  it.each([[{ drafts: true, all: true }], [{ next: true, all: true }]])(
    '%j: --all without an Inbox section is a usage error (exit 2, no request)',
    async o => {
      expect(statusUsageError(o)).toBe('--all goes with --inbox')
      expect(await status(o)).toBe(2)
      expect(urls).toEqual([])
    }
  )

  it('--all is fine in the full view and with --inbox', () => {
    expect(statusUsageError({ all: true })).toBeNull()
    expect(statusUsageError({ inbox: true, all: true })).toBeNull()
  })
})

describe('status --inbox (default: unread only)', () => {
  it('asks the server for unread=1 and prints only unread rows', async () => {
    expect(await status({ inbox: true })).toBeUndefined()
    expect(urls).toEqual(['/api/notifications?unread=1'])
    expect(out).toContain('1 unread notification\n')
    expect(out).toContain('Fresh thing')
    expect(out).not.toContain('Old read thing')
  })

  it('no unread → exactly one line', async () => {
    routes['/api/notifications?unread=1'] = {
      notifications: [],
      unreadCount: 0,
    }
    expect(await status({ inbox: true })).toBeUndefined()
    expect(out).toBe('No unread notifications.\n')
  })

  it('full view: the Inbox section says No unread notifications.', async () => {
    routes['/api/notifications?unread=1'] = {
      notifications: [],
      unreadCount: 0,
    }
    await status({})
    expect(out).toContain('\nInbox\nNo unread notifications.\n')
    expect(urls).toContain('/api/notifications?unread=1')
  })

  it('an older server that ignores unread=1: read rows are dropped locally, no error', async () => {
    // Old server: same payload with or without the parameter.
    routes['/api/notifications?unread=1'] = routes['/api/notifications']
    expect(await status({ inbox: true })).toBeUndefined()
    expect(err).toBe('')
    expect(out).toContain('Fresh thing')
    expect(out).not.toContain('Old read thing')
  })

  it('an older server with nothing unread prints the one line', async () => {
    routes['/api/notifications?unread=1'] = {
      notifications: [READ],
      unreadCount: 0,
    }
    await status({ inbox: true })
    expect(out).toBe('No unread notifications.\n')
  })

  it('at the server cap the count is a floor', async () => {
    const many = Array.from({ length: INBOX_SERVER_CAP }, (_, i) =>
      row(`n${i + 1}`, false)
    )
    routes['/api/notifications?unread=1'] = {
      notifications: many,
      unreadCount: INBOX_SERVER_CAP,
    }
    await status({ inbox: true })
    expect(out.split('\n')[0]).toBe(
      '50+ unread notifications (newest 50 shown)'
    )
  })
})

describe('status --inbox --all (everything, today’s shape)', () => {
  it('asks without the parameter and prints read rows too', async () => {
    await status({ inbox: true, all: true })
    expect(urls).toEqual(['/api/notifications'])
    expect(out.split('\n')[0]).toBe('2 notifications, 1 unread')
    expect(out).toContain('Fresh thing')
    expect(out).toContain('Old read thing')
  })
})

describe('--json', () => {
  it('default: only unread rows, filter "unread"', async () => {
    routes['/api/notifications?unread=1'] = routes['/api/notifications']
    await status({ inbox: true, json: true })
    expect(JSON.parse(out)).toEqual({
      version: 1,
      notifications: [UNREAD],
      unreadCount: 1,
      total: 1,
      nextCursor: null,
      filter: 'unread',
    })
  })

  it('--all: today’s envelope plus filter "all"', async () => {
    await status({ inbox: true, all: true, json: true })
    expect(JSON.parse(out)).toEqual({
      version: 1,
      notifications: [UNREAD, READ],
      unreadCount: 1,
      total: 2,
      nextCursor: null,
      filter: 'all',
    })
  })

  it('full view nests the filtered inbox', async () => {
    await status({ json: true })
    const body = JSON.parse(out)
    expect(body.inbox.filter).toBe('unread')
    expect(body.inbox.notifications).toEqual([UNREAD])
  })
})

describe('inboxView / formatInbox', () => {
  const raw: InboxResponse = { notifications: [UNREAD, READ], unreadCount: 1 }
  it('unread keeps unread rows; all keeps everything', () => {
    expect(inboxView(raw, 'unread')).toEqual({
      data: { notifications: [UNREAD], unreadCount: 1 },
      total: 1,
    })
    expect(inboxView(raw, 'all').data.notifications).toHaveLength(2)
  })
  it('total is null when the server returned its cap (before filtering)', () => {
    const capped: InboxResponse = {
      notifications: Array.from({ length: INBOX_SERVER_CAP }, (_, i) =>
        row(`n${i + 1}`, i > 0)
      ),
      unreadCount: 1,
    }
    expect(inboxView(capped, 'unread').total).toBeNull()
  })
  it('formatInbox: unread empty line vs all empty line', () => {
    const empty = { notifications: [], unreadCount: 0 }
    expect(formatInbox(empty, {}, 'unread')).toBe('No unread notifications.')
    expect(formatInbox(empty)).toBe('No notifications.')
  })
})
