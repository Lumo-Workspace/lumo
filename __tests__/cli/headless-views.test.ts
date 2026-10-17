/**
 * @jest-environment node
 *
 * LUM-1192: `lumo inbox list`, `lumo draft list`, `lumo project overview` —
 * the formatters (web wording / order / cuts) and
 * the commands' read-only calls (GET only, Bearer, --json passthrough).
 */
jest.mock('@/cli/src/lib/config', () => ({
  readCredentials: jest.fn(() => ({
    token: 'tok',
    apiUrl: 'https://api.lumo.test',
    workspaceSlug: 'lumo',
    workspaceName: 'Lumo HQ',
    email: 'me@x.com',
  })),
}))

import { fmtTimestamp } from '../../cli/src/lib/format'
import {
  formatInbox,
  inboxList,
  isPendingAction,
  notificationSentence,
  type InboxNotification,
} from '@/cli/src/commands/inbox-list'
import {
  draftList,
  draftTitle,
  formatDraftList,
  type DraftRow,
} from '@/cli/src/commands/draft-list'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectOverview } from '@/cli/src/commands/overview'
import {
  avgCompletionLabel,
  formatProjectOverview,
  idleDaysSince,
  statusLine,
  type OverviewStats,
} from '@/cli/src/lib/overview-format'
import { resolveProject } from '@/cli/src/lib/resolve'

let out: string
let err: string
let calls: Array<{ url: string; init: RequestInit | undefined }>

function serve(routes: Record<string, unknown>) {
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const path = String(url).replace('https://api.lumo.test', '')
    const hit = Object.entries(routes).find(([p]) => path === p)
    if (!hit) return new Response('{"error":"nope"}', { status: 404 })
    return new Response(JSON.stringify(hit[1]), { status: 200 })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  out = ''
  err = ''
  calls = []
  jest.spyOn(process.stdout, 'write').mockImplementation(s => {
    out += String(s)
    return true
  })
  jest.spyOn(console, 'error').mockImplementation((s: unknown) => {
    err += String(s)
  })
})
afterEach(() => jest.restoreAllMocks())

const base: InboxNotification = {
  id: 'n1',
  type: 'TASK_ASSIGNED',
  read: false,
  requiresAction: false,
  actionTakenAt: null,
  createdAt: '2026-10-16T09:00:00.000Z',
  actor: { name: 'Alice Chen' },
  task: { title: 'Fix login', number: 7, teamIdentifier: 'LUM' },
  sprint: null,
  project: null,
  milestone: null,
  document: null,
  commentPreview: null,
}

describe('notificationSentence (web inbox wording)', () => {
  it('actor + verb + task identifier and title', () => {
    expect(notificationSentence(base)).toBe(
      'Alice Chen assigned you to LUM-7 Fix login'
    )
  })
  it('falls back to "Lumo AI" and "a task"', () => {
    expect(notificationSentence({ ...base, actor: null, task: null })).toBe(
      'Lumo AI assigned you to a task'
    )
  })
  it('sprint / project / milestone / document subjects', () => {
    expect(
      notificationSentence({
        ...base,
        type: 'SPRINT_STARTED',
        sprint: { name: 'Sprint 4' },
      })
    ).toBe('Alice Chen started sprint Sprint 4')
    expect(
      notificationSentence({ ...base, type: 'SPRINT_CLOSED', task: null })
    ).toBe('Alice Chen closed sprint a sprint')
    expect(
      notificationSentence({
        ...base,
        type: 'PROJECT_MENTIONED',
        project: { name: 'Apollo' },
      })
    ).toBe('Alice Chen mentioned you in Apollo')
    expect(
      notificationSentence({
        ...base,
        type: 'MILESTONE_MENTIONED',
        milestone: { name: 'Beta' },
      })
    ).toBe('Alice Chen mentioned you in Beta')
    expect(
      notificationSentence({
        ...base,
        type: 'DOCUMENT_COMMENT_MENTIONED',
        document: { title: 'Spec' },
      })
    ).toBe('Alice Chen mentioned you in a comment on Spec')
  })
  it('unknown type → generic verb; control characters stripped', () => {
    expect(
      notificationSentence({
        ...base,
        type: 'SOMETHING_NEW',
        actor: { name: 'Eve\u001b[31m' },
      })
    ).toBe('Eve[31m sent you an update on LUM-7 Fix login')
  })
})

describe('formatInbox', () => {
  it('splits pending responses first, marks unread, shows mention previews', () => {
    const pending = {
      ...base,
      id: 'n2',
      type: 'AGENT_CLARIFY',
      requiresAction: true,
      read: true,
    }
    const mention = {
      ...base,
      id: 'n3',
      type: 'TASK_MENTIONED',
      read: true,
      commentPreview: 'can you   look\nat this?',
    }
    expect(isPendingAction(pending)).toBe(true)
    expect(isPendingAction({ ...pending, actionTakenAt: 'x' })).toBe(false)
    const text = formatInbox({
      notifications: [pending, base, mention],
      unreadCount: 1,
    })
    expect(text.split('\n')).toEqual([
      '3 notifications, 1 unread',
      '',
      'Needs your response',
      `  ${fmtTimestamp(base.createdAt)}  Alice Chen has a question about LUM-7 Fix login`,
      '',
      'Other',
      `• ${fmtTimestamp(base.createdAt)}  Alice Chen assigned you to LUM-7 Fix login`,
      `  ${fmtTimestamp(base.createdAt)}  Alice Chen mentioned you in LUM-7 Fix login`,
      '    "can you look at this?"',
    ])
  })
  it('empty inbox', () => {
    expect(formatInbox({ notifications: [], unreadCount: 0 })).toBe(
      'No notifications.'
    )
  })
})

describe('drafts', () => {
  const drafts: DraftRow[] = [
    {
      id: 'd1',
      type: 'TASK',
      data: { title: 'Add  OAuth' },
      createdAt: '2026-10-15T00:00:00.000Z',
      updatedAt: '2026-10-16T08:00:00.000Z',
    },
    {
      id: 'd2',
      type: 'PROJECT',
      data: { name: 'Apollo' },
      createdAt: '2026-10-15T00:00:00.000Z',
      updatedAt: '2026-10-15T08:00:00.000Z',
    },
    {
      id: 'd3',
      type: 'TASK',
      data: {},
      createdAt: '2026-10-15T00:00:00.000Z',
      updatedAt: '2026-10-14T08:00:00.000Z',
    },
  ]
  it('draftTitle: title for TASK, name for PROJECT, (untitled) when blank', () => {
    expect(drafts.map(draftTitle)).toEqual([
      'Add OAuth',
      'Apollo',
      '(untitled)',
    ])
  })
  it('formatDraftList: rows in server order, no id column (LUM-1230)', () => {
    const text = formatDraftList(drafts, { tty: false, color: false })
    const rows = text.split('\n')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatch(/^TASK\s+.+\s+Add OAuth$/)
    expect(rows[1]).toMatch(/^PROJECT\s+.+\s+Apollo$/)
    expect(text).not.toMatch(/\bd1\b|\bd2\b/)
    expect(formatDraftList([])).toBe('No drafts.')
  })
})

const stats: OverviewStats = {
  totalTasks: 10,
  statusDistribution: { TODO: 3, DONE: 4, IN_PROGRESS: 2, CANCELLED: 1 },
  overdueTasks: { count: 2 },
  memberWorkload: [{ name: 'Alice Chen', assigned: 5, completed: 3 }],
  completionTrend: Array.from({ length: 9 }, (_, i) => ({
    date: `2026-10-0${i + 1}`,
    completed: i + 1,
  })),
  avgCompletionTime: 12.345,
  topBlockers: {
    stalledTaskIds: [
      {
        id: 't1',
        identifier: 'LUM-3',
        title: 'Stuck thing',
        updatedAt: '2026-10-06T00:00:00.000Z',
      },
    ],
    highStakesTaskIds: [],
    staleOpenPrs: [
      {
        number: 42,
        openedAt: '2026-10-01T00:00:00.000Z',
        url: 'https://gh/pr/42',
      },
    ],
  },
}
const summary = {
  tldr: 'All good.\u001b[2J',
  report: '## Report\nLine two',
  generatedAt: '2026-10-16T09:00:00.000Z',
}

describe('overview formatting', () => {
  it('statusLine: web order first, then the rest A→Z, zeros kept', () => {
    expect(statusLine(stats.statusDistribution)).toBe(
      'BACKLOG 0 · TODO 3 · IN_PROGRESS 2 · IN_REVIEW 0 · DONE 4 · CANCELLED 1'
    )
  })
  it('avgCompletionLabel: one decimal in hours, N/A when unmeasured', () => {
    expect(avgCompletionLabel(12.345)).toBe('12.3h')
    expect(avgCompletionLabel(null)).toBe('N/A')
  })
  it('idleDaysSince: whole days, - when absent', () => {
    expect(
      idleDaysSince(
        '2026-10-06T00:00:00.000Z',
        new Date('2026-10-16T12:00:00Z')
      )
    ).toBe('10d')
    expect(idleDaysSince(undefined, new Date())).toBe('-')
  })
  it('project overview: cards, workload, last 7 trend days, summary', () => {
    const now = new Date('2026-10-16T12:00:00Z')
    const text = formatProjectOverview('Apollo', stats, summary, now)
    expect(text).toMatch(/Total tasks:\s+10/)
    expect(text).toMatch(/Completed:\s+4/)
    expect(text).toMatch(/Overdue:\s+2/)
    expect(text).toMatch(/Avg completion:\s+12.3h/)
    expect(text).toMatch(/Alice Chen\s+5\s+3/)
    expect(text).not.toContain('2026-10-02  2')
    expect(text).toContain('2026-10-03  3')
    expect(text).toContain('2026-10-09  9')
    expect(text).toContain('All good.[2J')
    expect(text).not.toContain('\u001b')
    expect(text).not.toContain('Line two')
    expect(
      formatProjectOverview('Apollo', stats, summary, now, { report: true })
    ).toContain('Line two')
    expect(formatProjectOverview('A', stats, null, now)).toContain(
      'None generated yet.'
    )
  })
  it('project overview: health counts and the stalled / stale PR rows', () => {
    const text = formatProjectOverview(
      'Apollo',
      stats,
      null,
      new Date('2026-10-16T12:00:00Z')
    )
    expect(text).toContain('Project: Apollo')
    expect(text).toContain(
      'Stalled 1 · High stakes 0 · Stale PRs 1 · Overdue 2'
    )
    expect(text).toContain('LUM-3  Stuck thing  idle 10d')
    expect(text).toContain('#42  opened 2026-10-01  https://gh/pr/42')
    expect(text).not.toContain('Projects')
  })
})

describe('commands (GET only, Bearer)', () => {
  it('inbox list → GET /api/notifications; --json is the payload', async () => {
    const payload = { notifications: [base], unreadCount: 1 }
    serve({ '/api/notifications': payload })
    await inboxList({ json: true })
    expect(JSON.parse(out)).toEqual(payload)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.init?.method).toBeUndefined()
    expect(
      (calls[0]!.init?.headers as Record<string, string>).Authorization
    ).toBe('Bearer tok')
  })
  it('draft list → GET /api/drafts (no workspaceUrl: the key decides)', async () => {
    serve({ '/api/drafts': { drafts: [] } })
    await draftList()
    expect(calls.map(c => c.url)).toEqual(['https://api.lumo.test/api/drafts'])
    expect(out).toBe('No drafts.\n')
  })
  it('project overview resolves the slug, then reads stats + summary', async () => {
    serve({
      '/api/projects': {
        projects: [
          { id: 'p1', name: 'Apollo Moon' },
          { id: 'p2', name: 'Idea', isIdea: true },
        ],
      },
      '/api/stats/project/p1': { stats },
      '/api/summaries/project/p1?limit=1': { summaries: [] },
    })
    await projectOverview('apollo-moon', { json: true })
    const body = JSON.parse(out)
    expect(body.project).toEqual({ id: 'p1', name: 'Apollo Moon' })
    expect(body.summary).toBeNull()
    expect(body.stats.totalTasks).toBe(10)
  })
  it('project overview: an unknown project exits 1 with a hint', async () => {
    serve({ '/api/projects': { projects: [{ id: 'p1', name: 'A' }] } })
    expect(await projectOverview('zzz')).toBe(1)
    expect(err).toContain('project "zzz" not found')
  })
  it('a 404 from the server (cross-tenant) exits 1', async () => {
    serve({ '/api/projects': { projects: [{ id: 'p1', name: 'A' }] } })
    expect(await projectOverview('a')).toBe(1)
  })
})

describe('resolveProject', () => {
  it('returns id and name; single visible project auto-selects', async () => {
    serve({
      '/api/projects': {
        projects: [
          { id: 'p1', name: 'Only' },
          { id: 'i1', name: 'Idea', isIdea: true },
        ],
      },
    })
    await expect(
      resolveProject('https://api.lumo.test', 'tok', undefined)
    ).resolves.toMatchObject({ id: 'p1', name: 'Only' })
  })
})

describe('lumo workspace overview is gone (LUM-1228)', () => {
  const root = process.cwd()
  it('is not in the command grammar; project overview still is', () => {
    const grammar = readFileSync(
      join(root, 'scripts/cli-grammar/grammar.json'),
      'utf8'
    )
    expect(grammar).not.toContain('"workspace overview"')
    expect(grammar).toContain('"project overview"')
  })
  it('is not registered, documented or allow-listed', () => {
    const read = (f: string) => readFileSync(join(root, f), 'utf8')
    for (const f of [
      'cli/src/index.ts',
      'cli/src/lib/codex-rules.ts',
      '.claude/skills/lumo/SKILL.md',
      '.claude/skills/lumo/references/overview.md',
    ]) {
      expect(read(f)).not.toMatch(/workspace overview|workspaceOverview/)
    }
    expect(read('cli/src/index.ts')).not.toMatch(
      /workspaceCmd\s*\.command\('overview'\)/
    )
  })
})
