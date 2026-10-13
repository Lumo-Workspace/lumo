/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findToolAttributionEvents: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findById: jest.fn(), labelsByIds: jest.fn() },
}))
jest.mock('@/lib/repositories/report.repository', () => ({
  reportRepository: {
    listDoneTransitionsSince: jest.fn(),
    findTasksForReport: jest.fn(),
    listProjectTaskIds: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-cli.service', () => ({
  resolveProjectId: jest.fn(),
}))

import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { reportRepository } from '@/lib/repositories/report.repository'
import { resolveProjectId } from '@/lib/services/task-cli.service'
import { formatReport } from '@/cli/src/commands/report'
import {
  buildReport,
  completionsInWindow,
  defaultReportWindow,
  lastDoneAt,
  PROJECT_IN_LIST_MAX,
  reportService,
  sessionCoverage,
  UNASSIGNED_LABEL,
  validateReportInput,
} from '@/lib/services/report.service'

const SINCE = new Date('2026-10-06T00:00:00.000Z')
const UNTIL = new Date('2026-10-13T00:00:00.000Z')
const at = (iso: string) => new Date(iso)
const done = (taskId: string, iso: string, to = 'DONE') => ({
  taskId,
  payload: { from: 'IN_REVIEW', to },
  createdAt: at(iso),
})
const stop = (
  sessionId: string,
  member: string,
  iso: string,
  usage: Record<string, unknown> | null,
  taskId: string | null = null
) => ({
  sessionId,
  workspaceMemberId: member,
  taskId,
  type: 'STOP',
  toolName: null,
  toolDetail: null,
  toolVerb: null,
  usageByModel: usage,
  createdAt: at(iso),
})
const usage = (output: number) => ({
  'claude-opus': { input: 1, output, cacheRead: 0, cacheCreation: 0 },
})

const repo = reportRepository as jest.Mocked<typeof reportRepository>
const hooks = hookEventRepository as jest.Mocked<typeof hookEventRepository>
const members = memberRepository as jest.Mocked<typeof memberRepository>

beforeEach(() => {
  jest.resetAllMocks()
  members.labelsByIds.mockImplementation(
    async ids => new Map(ids.map(id => [id, `label:${id}`]))
  )
  repo.findTasksForReport.mockImplementation(async (_ws, ids) =>
    ids.map(id => ({
      id,
      identifier: `LUM-${id}`,
      title: `Task ${id}`,
      assigneeMemberId: id === 't3' ? null : 'm1',
      assigneeAgentName: id === 't3' ? 'Coding Agent' : null,
    }))
  )
  hooks.findToolAttributionEvents.mockResolvedValue([])
  repo.listDoneTransitionsSince.mockResolvedValue([])
})

describe('completion-time derivation', () => {
  it('keeps a task whose DONE falls inside the window', () => {
    const c = completionsInWindow(
      lastDoneAt([done('a', '2026-10-08T10:00:00Z')]),
      SINCE,
      UNTIL
    )
    expect([...c.keys()]).toEqual(['a'])
  })

  it('drops a task whose DONE falls outside the window (until is exclusive)', () => {
    const c = completionsInWindow(
      lastDoneAt([
        done('late', '2026-10-13T00:00:00Z'),
        done('later', '2026-10-20T00:00:00Z'),
      ]),
      SINCE,
      UNTIL
    )
    expect(c.size).toBe(0)
  })

  it('uses the LAST DONE when a task was reopened and DONE again', () => {
    // DONE in window, reopened, DONE again after the window → not this window.
    const movedOut = completionsInWindow(
      lastDoneAt([
        done('r1', '2026-10-07T00:00:00Z'),
        done('r1', '2026-10-15T00:00:00Z'),
      ]),
      SINCE,
      UNTIL
    )
    expect(movedOut.size).toBe(0)
    // Two DONEs both in window → counted once, at the final one.
    const twice = completionsInWindow(
      lastDoneAt([
        done('r2', '2026-10-12T00:00:00Z'),
        done('r2', '2026-10-07T00:00:00Z'),
      ]),
      SINCE,
      UNTIL
    )
    expect(twice.get('r2')?.toISOString()).toBe('2026-10-12T00:00:00.000Z')
  })

  it('ignores non-DONE transitions and malformed payloads', () => {
    const d = lastDoneAt([
      done('x', '2026-10-08T00:00:00Z', 'IN_REVIEW'),
      { taskId: 'y', payload: null, createdAt: at('2026-10-08T00:00:00Z') },
    ])
    expect(d.size).toBe(0)
  })

  it('drops a trashed task the repository no longer returns', async () => {
    repo.listDoneTransitionsSince.mockResolvedValue([
      done('t1', '2026-10-08T00:00:00Z'),
      done('trashed', '2026-10-09T00:00:00Z'),
    ])
    repo.findTasksForReport.mockResolvedValue([
      {
        id: 't1',
        identifier: 'LUM-1',
        title: 'Live',
        assigneeMemberId: 'm1',
        assigneeAgentName: null,
      },
    ])
    const r = await reportService.getReport('w1', {
      since: SINCE,
      until: UNTIL,
    })
    expect(r.completedTasks.items.map(t => t.identifier)).toEqual(['LUM-1'])
    expect(r.team.completedCount).toBe(1)
  })
})

describe('token null semantics', () => {
  it('counts a session with no recorded usage as unmetered, not as 0 tokens', async () => {
    hooks.findToolAttributionEvents.mockResolvedValue([
      stop('s1', 'm1', '2026-10-08T00:00:00Z', usage(99)),
      stop('s2', 'm1', '2026-10-08T01:00:00Z', null),
    ] as never)
    const r = await reportService.getReport('w1', {
      since: SINCE,
      until: UNTIL,
    })
    expect(r.team.tokens.total).toBe(100)
    expect(r.team.sessions).toBe(2)
    expect(r.team.unmeteredSessions).toBe(1)
    expect(r.byMember[0]).toMatchObject({
      memberId: 'm1',
      sessions: 2,
      unmeteredSessions: 1,
    })
  })

  it('sessionCoverage marks a session metered once any event has usage', () => {
    const cov = sessionCoverage([
      { sessionId: 's', workspaceMemberId: 'm', usageByModel: null },
      { sessionId: 's', workspaceMemberId: 'm', usageByModel: {} },
      { sessionId: null, workspaceMemberId: 'm', usageByModel: null },
    ])
    expect(cov.get('m')?.sessions.size).toBe(1)
    expect(cov.get('m')?.metered.size).toBe(1)
  })

  it('folds subagent child sessions into their parent session', () => {
    const cov = sessionCoverage([
      { sessionId: 'p1', workspaceMemberId: 'm', usageByModel: null },
      { sessionId: 'p1:agent1', workspaceMemberId: 'm', usageByModel: {} },
      { sessionId: 'p1:agent2', workspaceMemberId: 'm', usageByModel: null },
    ])
    expect(cov.get('m')?.sessions.size).toBe(1)
    expect(cov.get('m')?.metered.size).toBe(1)
  })

  it('labels a member whose only activity is unmetered sessions', async () => {
    hooks.findToolAttributionEvents.mockResolvedValue([
      stop('s9', 'm9', '2026-10-08T00:00:00Z', null),
    ] as never)
    const r = await reportService.getReport('w1', {
      since: SINCE,
      until: UNTIL,
    })
    expect(members.labelsByIds).toHaveBeenCalledWith(['m9'])
    expect(r.byMember[0]).toMatchObject({
      memberId: 'm9',
      label: 'label:m9',
      unmeteredSessions: 1,
    })
  })
})

describe('multi-tenant scoping', () => {
  it('passes the caller workspace to every repository read', async () => {
    repo.listDoneTransitionsSince.mockResolvedValue([
      done('t1', '2026-10-08T00:00:00Z'),
    ])
    await reportService.getReport('w1', { since: SINCE, until: UNTIL })
    expect(hooks.findToolAttributionEvents).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w1', since: SINCE, until: UNTIL })
    )
    expect(repo.listDoneTransitionsSince).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w1', since: SINCE })
    )
    expect(repo.findTasksForReport).toHaveBeenCalledWith('w1', ['t1'])
  })

  it('rejects a member id from another workspace with 404 and reads nothing', async () => {
    members.findById.mockResolvedValue({
      id: 'mX',
      workspaceId: 'other',
      role: 'MEMBER',
    } as never)
    await expect(
      reportService.getReport('w1', {
        since: SINCE,
        until: UNTIL,
        memberId: 'mX',
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(hooks.findToolAttributionEvents).not.toHaveBeenCalled()
    expect(members.labelsByIds).not.toHaveBeenCalled()
  })

  it('narrows tokens to the project tasks when --project is given', async () => {
    ;(resolveProjectId as jest.Mock).mockResolvedValue('p1')
    repo.listProjectTaskIds.mockResolvedValue(['t1', 't2'])
    hooks.findToolAttributionEvents.mockResolvedValue([
      stop('in', 'm1', '2026-10-08T00:00:00Z', usage(9), 't1'),
      stop('other', 'm1', '2026-10-08T00:00:00Z', usage(99), 'tX'),
      stop('loose', 'm2', '2026-10-08T00:00:00Z', usage(99), null),
    ] as never)
    const r = await reportService.getReport('w1', {
      since: SINCE,
      until: UNTIL,
      projectRef: 'Lumo',
    })
    expect(resolveProjectId).toHaveBeenCalledWith('w1', 'Lumo')
    expect(repo.listProjectTaskIds).toHaveBeenCalledWith('w1', 'p1')
    // A small project narrows the scan in the DB…
    expect(hooks.findToolAttributionEvents).toHaveBeenCalledWith(
      expect.objectContaining({ taskIds: ['t1', 't2'] })
    )
    expect(r.team.tokens.total).toBe(10)
    expect(r.team.sessions).toBe(1)
    expect(repo.listDoneTransitionsSince).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1' })
    )
    expect(r.filter.projectId).toBe('p1')
  })

  it('filters a large project in memory instead of an unbounded IN list', async () => {
    ;(resolveProjectId as jest.Mock).mockResolvedValue('p1')
    const ids = Array.from(
      { length: PROJECT_IN_LIST_MAX + 1 },
      (_, i) => `t${i}`
    )
    repo.listProjectTaskIds.mockResolvedValue(ids)
    hooks.findToolAttributionEvents.mockResolvedValue([
      stop('in', 'm1', '2026-10-08T00:00:00Z', usage(9), 't5'),
      stop('out', 'm1', '2026-10-08T00:00:00Z', usage(99), 'elsewhere'),
    ] as never)
    const r = await reportService.getReport('w1', {
      since: SINCE,
      until: UNTIL,
      projectRef: 'Big',
    })
    const scope = hooks.findToolAttributionEvents.mock.calls[0]![0] as {
      taskIds?: string[]
    }
    expect(scope.taskIds).toBeUndefined()
    expect(r.team.tokens.total).toBe(10)
  })

  it('skips the event scan for a project with no tasks', async () => {
    ;(resolveProjectId as jest.Mock).mockResolvedValue('p1')
    repo.listProjectTaskIds.mockResolvedValue([])
    await reportService.getReport('w1', {
      since: SINCE,
      until: UNTIL,
      projectRef: 'Empty',
    })
    expect(hooks.findToolAttributionEvents).not.toHaveBeenCalled()
  })
})

describe('team + per-member views', () => {
  beforeEach(() => {
    hooks.findToolAttributionEvents.mockResolvedValue([
      stop('s1', 'm1', '2026-10-08T00:00:00Z', usage(9)),
      stop('s2', 'm2', '2026-10-08T00:00:00Z', usage(49)),
    ] as never)
    repo.listDoneTransitionsSince.mockResolvedValue([
      done('t1', '2026-10-08T00:00:00Z'),
      done('t2', '2026-10-10T00:00:00Z'),
      done('t3', '2026-10-09T00:00:00Z'),
    ])
  })

  it('returns team totals, a byMember split and assignees on every task', async () => {
    const r = await reportService.getReport('w1', {
      since: SINCE,
      until: UNTIL,
    })
    expect(r.version).toBe(1)
    expect(r.window).toEqual({
      since: SINCE.toISOString(),
      until: UNTIL.toISOString(),
    })
    expect(r.team.tokens).toEqual({
      input: 2,
      output: 58,
      cacheRead: 0,
      cacheCreation: 0,
      total: 60,
    })
    expect(r.team.byModel).toEqual([
      expect.objectContaining({ model: 'claude-opus', total: 60 }),
    ])
    expect(r.team.completedCount).toBe(3)
    expect(
      r.byMember.map(m => [m.label, m.tokens.total, m.completedCount])
    ).toEqual([
      ['label:m2', 50, 0],
      ['label:m1', 10, 2],
      [UNASSIGNED_LABEL, 0, 1],
    ])
    expect(r.completedTasks.items).toEqual([
      {
        identifier: 'LUM-t2',
        title: 'Task t2',
        completedAt: '2026-10-10T00:00:00.000Z',
        memberId: 'm1',
        assignee: 'label:m1',
      },
      {
        identifier: 'LUM-t3',
        title: 'Task t3',
        completedAt: '2026-10-09T00:00:00.000Z',
        memberId: null,
        assignee: 'Coding Agent',
      },
      {
        identifier: 'LUM-t1',
        title: 'Task t1',
        completedAt: '2026-10-08T00:00:00.000Z',
        memberId: 'm1',
        assignee: 'label:m1',
      },
    ])
  })

  it('--member narrows tokens (server-side) and tasks to one member', async () => {
    members.findById.mockResolvedValue({
      id: 'm1',
      workspaceId: 'w1',
      role: 'MEMBER',
    } as never)
    hooks.findToolAttributionEvents.mockResolvedValue([
      stop('s1', 'm1', '2026-10-08T00:00:00Z', usage(9)),
    ] as never)
    const r = await reportService.getReport('w1', {
      since: SINCE,
      until: UNTIL,
      memberId: 'm1',
    })
    expect(hooks.findToolAttributionEvents).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceMemberId: 'm1' })
    )
    expect(r.filter.memberId).toBe('m1')
    expect(r.byMember.map(m => m.memberId)).toEqual(['m1'])
    expect(r.completedTasks.items.map(t => t.identifier)).toEqual([
      'LUM-t2',
      'LUM-t1',
    ])
    expect(r.team.completedCount).toBe(2)
  })

  it('truncates the list to limit but keeps the full total', async () => {
    const r = await reportService.getReport('w1', {
      since: SINCE,
      until: UNTIL,
      limit: 1,
    })
    expect(r.completedTasks.total).toBe(3)
    expect(r.completedTasks.items).toHaveLength(1)
  })
})

describe('empty window', () => {
  it('returns zeros and empty lists', async () => {
    const r = await reportService.getReport('w1', {
      since: SINCE,
      until: UNTIL,
    })
    expect(r.team).toEqual({
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
      sessions: 0,
      unmeteredSessions: 0,
      completedCount: 0,
      byModel: [],
    })
    expect(r.byMember).toEqual([])
    expect(r.completedTasks).toEqual({ total: 0, items: [] })
  })

  it('buildReport shows the filtered member row even with no activity', () => {
    const r = buildReport({
      since: SINCE,
      until: UNTIL,
      memberId: 'm9',
      projectId: null,
      limit: 50,
      costRows: [],
      coverage: new Map(),
      completions: new Map(),
      tasks: [],
      memberLabels: new Map([['m9', 'Nine']]),
    })
    expect(r.byMember).toEqual([
      expect.objectContaining({
        memberId: 'm9',
        label: 'Nine',
        completedCount: 0,
      }),
    ])
  })
})

// LUM-1116
describe('token rounding + session-less usage', () => {
  const row = (over: Record<string, unknown>) => ({
    tool: 'Bash',
    verb: null,
    model: 'claude-opus',
    sessionId: 's1',
    workspaceMemberId: 'm1',
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
    ...over,
  })

  it('reports whole-number token totals even when attributed shares are fractional', () => {
    const r = buildReport({
      since: SINCE,
      until: UNTIL,
      memberId: null,
      projectId: null,
      limit: 50,
      costRows: [
        row({ output: 0.1, input: 113919.3 }),
        row({ output: 0.2, input: 113919.3 }),
        row({
          output: 227838.4,
          input: 113919.3,
          cacheRead: 0.30000000000000004,
        }),
      ],
      coverage: new Map(),
      completions: new Map(),
      tasks: [],
      memberLabels: new Map([['m1', 'One']]),
    })
    const all = [
      r.team.tokens,
      ...r.team.byModel,
      ...r.byMember.map(m => m.tokens),
    ]
    for (const t of all)
      for (const k of [
        'input',
        'output',
        'cacheRead',
        'cacheCreation',
        'total',
      ] as const)
        expect(Number.isInteger(t[k])).toBe(true)
    expect(r.team.tokens.total).toBe(569597)
    expect(r.team.tokens.output).toBe(227839)
    for (const t of all)
      expect(t.total).toBe(t.input + t.output + t.cacheRead + t.cacheCreation)
  })

  it('keeps total equal to the sum of its rounded parts', () => {
    const r = buildReport({
      since: SINCE,
      until: UNTIL,
      memberId: null,
      projectId: null,
      limit: 50,
      costRows: [row({ input: 0.4, output: 0.4, cacheRead: 0.4 })],
      coverage: new Map(),
      completions: new Map(),
      tasks: [],
      memberLabels: new Map([['m1', 'One']]),
    })
    expect(r.team.tokens).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
      total: 0,
    })
  })

  it('counts tokens from events with no session id (sessions stay 0)', async () => {
    hooks.findToolAttributionEvents.mockResolvedValue([
      {
        ...stop('x', 'm1', '2026-10-08T10:00:00.000Z', usage(500)),
        sessionId: null,
      },
    ] as never)
    const r = await reportService.getReport('ws-1', {
      since: SINCE,
      until: UNTIL,
    })
    // The usage is attributed in full (input 1 + output 500) …
    expect(r.team.tokens).toMatchObject({ input: 1, output: 500, total: 501 })
    expect(r.team.byModel).toEqual([
      expect.objectContaining({ model: 'claude-opus', total: 501 }),
    ])
    expect(r.byMember).toEqual([
      expect.objectContaining({
        memberId: 'm1',
        tokens: expect.objectContaining({ total: 501 }),
        sessions: 0,
        unmeteredSessions: 0,
      }),
    ])
    // … with no session behind it, and `lumo report` still prints the tokens.
    expect(r.team.sessions).toBe(0)
    expect(r.team.unmeteredSessions).toBe(0)
    const out = formatReport(r, {
      window: {
        sinceDay: '2026-10-06',
        untilDay: '2026-10-12',
        sinceIso: SINCE.toISOString(),
        untilIso: UNTIL.toISOString(),
        days: 7,
      },
    })
    expect(out).toMatch(/Tokens:\s+501 \(output 500/)
    expect(out).not.toContain('none recorded')
  })
})

describe('validation + defaults', () => {
  it('rejects since >= until, too-wide windows and bad limits', () => {
    expect(() => validateReportInput({ since: UNTIL, until: SINCE })).toThrow(
      /before/
    )
    expect(() =>
      validateReportInput({
        since: new Date('2024-01-01T00:00:00Z'),
        until: UNTIL,
      })
    ).toThrow(/too wide/)
    expect(() =>
      validateReportInput({ since: SINCE, until: UNTIL, limit: 0 })
    ).toThrow(/limit/)
    // 366 local days across a DST shift is 366d + 1h: still accepted.
    expect(() =>
      validateReportInput({
        since: new Date(UNTIL.getTime() - 366 * 86_400_000 - 3_600_000),
        until: UNTIL,
      })
    ).not.toThrow()
    expect(validateReportInput({ since: SINCE, until: UNTIL })).toBe(50)
  })

  it('defaults to the 7 days before now', () => {
    const w = defaultReportWindow(UNTIL)
    expect(w.since.toISOString()).toBe('2026-10-06T00:00:00.000Z')
    expect(w.until).toBe(UNTIL)
  })
})
