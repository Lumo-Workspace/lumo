/**
 * @jest-environment node
 *
 * LUM-1233 batch 3f (Q1, Q2) — `lumo status` replaces `inbox list`,
 * `draft list` and `next` (sections Inbox / Drafts / Next, plus the team
 * priority line); `priority` becomes `priority create|list` with no prompt.
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://lumo.test',
    workspaceSlug: 'lumo',
  })),
}))

import fs from 'fs'
import path from 'path'
import {
  formatPriorityLine,
  status,
  statusSections,
  statusUsageError,
} from '@/cli/src/commands/status'
import { findRemovedCommand } from '@/cli/src/lib/removed-commands'
import { CODEX_SERVER_ONLY_COMMANDS } from '@/cli/src/lib/codex-rules'

const PRIORITY = {
  id: 'p1',
  statement: 'Ship the  billing\nMVP',
  effectiveFrom: '2026-10-01T12:00:00.000Z',
  declaredByMemberId: 'm1',
  createdAt: '2026-10-01T12:00:00.000Z',
}
const TASK = {
  id: 't1',
  number: 7,
  title: 'Fix login',
  status: 'TODO',
  priority: 'URGENT',
  teamIdentifier: 'LUM',
  sprintId: null,
  dueDate: null,
  updatedAt: '2026-10-01T00:00:00.000Z',
}
const ROUTES: Record<string, unknown> = {
  '/api/priorities': { current: PRIORITY, history: [PRIORITY] },
  '/api/notifications': { notifications: [], unreadCount: 0 },
  '/api/drafts': { drafts: [] },
  '/api/me/active-sprints': { sprintIds: [] },
  '/api/tasks/me': { tasks: [TASK] },
}

let out: string
let err: string
let calls: string[]
let failing: Set<string>
beforeEach(() => {
  out = ''
  err = ''
  calls = []
  failing = new Set()
  process.env.LUMO_NO_HINTS = '1'
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
    const p = new URL(url).pathname
    calls.push(p)
    if (failing.has(p))
      return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ROUTES[p] }
  }) as unknown as typeof fetch
})
afterEach(() => {
  delete process.env.LUMO_NO_HINTS
  jest.restoreAllMocks()
})

describe('status flags', () => {
  it('no section flag = every section; flags pick sections', () => {
    expect(statusSections({})).toEqual(['inbox', 'drafts', 'next'])
    expect(statusSections({ drafts: true, next: true })).toEqual([
      'drafts',
      'next',
    ])
  })
  it.each([
    [{ inbox: true, claimable: true }, /--claimable goes with --next/],
    [{ drafts: true, limit: '2' }, /--limit goes with --next/],
    [{ limit: '0' }, /invalid --limit/],
    [{ next: true, limit: 'x' }, /invalid --limit/],
  ])('%j is a usage error (exit 2, no request)', async (o, msg) => {
    expect(statusUsageError(o)).toMatch(msg)
    expect(await status(o)).toBe(2)
    expect(calls).toEqual([])
  })
  it('--limit / --claimable are fine in the full view and with --next', () => {
    expect(statusUsageError({ limit: '5', claimable: true })).toBeNull()
    expect(statusUsageError({ next: true, limit: '1' })).toBeNull()
  })
})

describe('status output', () => {
  it('full view: priority line, then Inbox, Drafts, Next', async () => {
    expect(await status({})).toBeUndefined()
    expect(out.split('\n')[0]).toBe(
      'Priority: Ship the billing MVP (since 2026-10-01)'
    )
    const at = (h: string) => out.indexOf(`\n${h}\n`)
    expect(at('Inbox')).toBeGreaterThan(0)
    expect(at('Drafts')).toBeGreaterThan(at('Inbox'))
    expect(at('Next')).toBeGreaterThan(at('Drafts'))
    expect(out).toContain('LUM-7')
  })

  it('one section flag prints only that section, no heading, no priority', async () => {
    await status({ drafts: true })
    expect(out).toBe('No drafts.\n')
    expect(calls).toEqual(['/api/drafts'])
  })

  it('--next --limit 1 reads tasks only', async () => {
    await status({ next: true, limit: '1' })
    expect(calls.sort()).toEqual(['/api/me/active-sprints', '/api/tasks/me'])
    expect(out).toMatch(/Top 1 recommended task \(of 1 open\)/)
  })

  it('full --json nests the sections under one version', async () => {
    await status({ json: true })
    const body = JSON.parse(out)
    expect(Object.keys(body).sort()).toEqual(
      ['drafts', 'inbox', 'next', 'priority', 'version'].sort()
    )
    expect(body.priority.id).toBe('p1')
    expect(body.inbox).toEqual({
      notifications: [],
      unreadCount: 0,
      total: 0,
      nextCursor: null,
    })
    expect(body.next.tasks[0].ref).toBe('LUM-7')
    expect(body.next.version).toBeUndefined()
  })

  it('a failing section reports, the rest still print, exit 1', async () => {
    failing.add('/api/notifications')
    expect(await status({})).toBe(1)
    expect(err).toMatch(/inbox/i)
    expect(out).toContain('\nDrafts\n')
    expect(out).toContain('LUM-7')
  })

  it('formatPriorityLine without a declaration', () => {
    expect(formatPriorityLine(null)).toBe('Priority: none declared')
  })
})

describe('tombstones', () => {
  const tv = (_p: string, f: string) => ['--count', '-n', '--limit'].includes(f)
  it.each([
    [['inbox', 'list'], 'lumo status --inbox'],
    [['inbox', 'list', '--json'], 'lumo status --inbox --json'],
    [['inbox'], 'lumo status --inbox'],
    [['draft', 'list'], 'lumo status --drafts'],
    [['draft'], 'lumo status --drafts'],
    [['next'], 'lumo status --next'],
    [
      ['next', '--count', '5', '--claimable'],
      'lumo status --next --limit 5 --claimable',
    ],
    [['next', '--count=4'], 'lumo status --next --limit=4'],
    [['next', '-n', '2', '--json'], 'lumo status --next -n 2 --json'],
    [['priority', 'Ship the MVP'], "lumo priority create 'Ship the MVP'"],
    [['priority', 'Ship', 'it'], "lumo priority create 'Ship it'"],
  ])('%j → %s', (argv, replacement) => {
    expect(findRemovedCommand(argv, tv)?.replacement).toBe(replacement)
  })

  it('priority create / list and status are live', () => {
    expect(findRemovedCommand(['priority', 'create', 'x'])).toBeNull()
    expect(findRemovedCommand(['priority', 'list'])).toBeNull()
    expect(findRemovedCommand(['priority'])).toBeNull()
    expect(findRemovedCommand(['status', '--next'])).toBeNull()
  })
})

describe('grammar and Codex rules', () => {
  const grammar = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../scripts/cli-grammar/grammar.json'),
      'utf8'
    )
  ) as {
    commands: Record<
      string,
      { flags: Record<string, unknown>; isInvokable: boolean }
    >
  }

  it('has status and priority create, no next / inbox / draft, priority not invokable', () => {
    for (const gone of ['next', 'inbox', 'inbox list', 'draft', 'draft list'])
      expect(grammar.commands).not.toHaveProperty([gone])
    expect(Object.keys(grammar.commands.status!.flags).sort()).toEqual(
      [
        '--claimable',
        '--drafts',
        '--inbox',
        '--json',
        '--limit',
        '--next',
      ].sort()
    )
    expect(grammar.commands).toHaveProperty(['priority create'])
    expect(grammar.commands.priority!.isInvokable).toBe(false)
  })

  it('status runs outside the Codex sandbox; the removed paths are gone', () => {
    expect(CODEX_SERVER_ONLY_COMMANDS).toContain('status')
    for (const gone of ['next', 'inbox list', 'draft list'])
      expect(CODEX_SERVER_ONLY_COMMANDS).not.toContain(gone)
  })
})
