/**
 * @jest-environment node
 *
 * LUM-1100 — `lumo usage show --tasks` (formerly `lumo report`): window resolution, rendering (data + empty
 * state), --json passthrough, --member resolution.
 */
jest.mock('../../src/lib/config', () => ({
  readCredentials: jest.fn(),
}))

import { readCredentials } from '../../src/lib/config'
import {
  formatReport,
  report,
  resolveReportWindow,
  type ReportResponseDto,
  type ReportWindow,
} from '../../src/commands/report'
import { localDayStart } from '../../src/lib/local-day'

const mockRead = readCredentials as jest.Mock
// Local noon on 2026-10-13, so the test holds in any TZ.
const NOW = new Date(2026, 9, 13, 12, 0, 0)

function win(opts: { since?: string; until?: string }): ReportWindow {
  const r = resolveReportWindow(opts, NOW)
  if (!r.ok) throw new Error(r.error)
  return r.window
}

describe('resolveReportWindow', () => {
  it('defaults to the last 7 local days including today', () => {
    const w = win({})
    expect(w).toMatchObject({
      sinceDay: '2026-10-07',
      untilDay: '2026-10-13',
      days: 7,
    })
    expect(w.sinceIso).toBe(localDayStart('2026-10-07'))
    // until is exclusive: local midnight AFTER the last day.
    expect(w.untilIso).toBe(localDayStart('2026-10-14'))
  })

  it('accepts Nd shortcuts, explicit days and named days', () => {
    expect(win({ since: '30d' })).toMatchObject({
      sinceDay: '2026-09-14',
      days: 30,
    })
    expect(win({ since: '1d' })).toMatchObject({
      sinceDay: '2026-10-13',
      untilDay: '2026-10-13',
      days: 1,
    })
    expect(win({ since: '2026-10-01', until: '2026-10-05' })).toMatchObject({
      sinceDay: '2026-10-01',
      untilDay: '2026-10-05',
      days: 5,
    })
    expect(win({ since: 'yesterday', until: 'yesterday' })).toMatchObject({
      sinceDay: '2026-10-12',
      untilDay: '2026-10-12',
    })
    // --until alone keeps a 7-day window ending there.
    expect(win({ until: '2026-10-05' })).toMatchObject({
      sinceDay: '2026-09-29',
      untilDay: '2026-10-05',
    })
  })

  // LUM-1116: Nd counts back from --until, not from today.
  it('--since Nd ends on --until when both are given', () => {
    expect(win({ since: '7d', until: '2026-09-01' })).toMatchObject({
      sinceDay: '2026-08-26',
      untilDay: '2026-09-01',
      days: 7,
    })
    expect(win({ since: '1d', until: 'yesterday' })).toMatchObject({
      sinceDay: '2026-10-12',
      untilDay: '2026-10-12',
      days: 1,
    })
  })

  it('rejects malformed values and an inverted window', () => {
    for (const bad of [
      { since: 'last week' },
      { since: '2026-02-31' },
      { since: '0d' },
      { until: '7d' },
      { since: '2026-10-10', until: '2026-10-01' },
      { since: '400d' },
    ]) {
      expect(resolveReportWindow(bad, NOW).ok).toBe(false)
    }
  })
})

const tokens = (total: number) => ({
  input: 0,
  output: total,
  cacheRead: 0,
  cacheCreation: 0,
  total,
})

const data: ReportResponseDto = {
  version: 1,
  window: {
    since: '2026-10-06T13:00:00.000Z',
    until: '2026-10-13T13:00:00.000Z',
  },
  filter: { memberId: null, projectId: null },
  team: {
    tokens: tokens(1234567),
    sessions: 5,
    unmeteredSessions: 2,
    completedCount: 2,
    byModel: [{ model: 'claude-opus', ...tokens(1234567) }],
  },
  byMember: [
    {
      memberId: 'm1',
      label: 'Alice',
      tokens: tokens(1000000),
      byModel: [{ model: 'claude-opus', ...tokens(1000000) }],
      sessions: 3,
      unmeteredSessions: 1,
      completedCount: 1,
    },
    {
      memberId: null,
      label: '(unassigned)',
      tokens: tokens(0),
      byModel: [],
      sessions: 0,
      unmeteredSessions: 0,
      completedCount: 1,
    },
  ],
  completedTasks: {
    total: 3,
    items: [
      {
        identifier: 'LUM-2',
        title: 'Ship report',
        completedAt: new Date(2026, 9, 12, 9).toISOString(),
        memberId: 'm1',
        assignee: 'Alice',
      },
      {
        identifier: 'LUM-1',
        title: 'Evil \u001b[31mtitle',
        completedAt: new Date(2026, 9, 8, 9).toISOString(),
        memberId: null,
        assignee: null,
      },
    ],
  },
}

describe('formatReport', () => {
  const out = formatReport(data, { window: win({}) })

  it('starts with a one-line window header', () => {
    expect(out.split('\n')[0]).toBe(
      'Report 2026-10-07 → 2026-10-13 (7 days) · workspace'
    )
  })

  it('shows team tokens and calls out unmetered sessions instead of treating them as 0', () => {
    expect(out).toMatch(/Tokens:\s+1\.2M \(input 0 · output 1\.2M/)
    expect(out).toContain(
      '5 (2 unmetered — no token usage recorded, not counted as 0)'
    )
    expect(out).toMatch(/Completed:\s+2 tasks/)
  })

  it('splits tokens and completed counts per member', () => {
    const alice = out.split('\n').find(l => l.startsWith('Alice'))
    // LUM-1232 L-3: piped rows are TAB-separated, plain integers, `-` for empty cells.
    expect(alice).toBe('Alice\t-\t-\t-\t-\t1000000\t3 (1 unmetered)\t1')
    const unassigned = out.split('\n').find(l => l.startsWith('(unassigned)'))
    expect(unassigned).toBe('(unassigned)\t-\t-\t-\t-\t-\t0\t1')
  })

  // LUM-1123 follow-up: the summary line is compact, with the same kind
  // names and order as the By model table, on a TTY and when piped.
  it('summary line uses compact figures with the table kind names and order', () => {
    const mixed = {
      input: 21_300,
      output: 3_190_000,
      cacheCreation: 52_400_000,
      cacheRead: 1_050_000_000,
      total: 1_105_611_300,
    }
    const report = (tty: boolean) =>
      formatReport(
        {
          ...data,
          team: {
            ...data.team,
            tokens: mixed,
            byModel: [{ model: 'claude-opus', ...mixed }],
          },
        },
        { window: win({}), tty }
      )
    for (const tty of [false, true]) {
      const line = report(tty)
        .split('\n')
        .find(l => l.startsWith('Tokens:'))
      expect(line).toMatch(
        /^Tokens:\s+1\.1B \(input 21\.3K · output 3\.2M · cache write 52\.4M · cache read 1\.1B\)$/
      )
    }
  })

  // LUM-1123
  it('By model lists input / output / cache write / cache read / total per model', () => {
    const tty = formatReport(data, { window: win({}), tty: true, width: 200 })
    expect(tty.split('\n')).toContainEqual(
      expect.stringMatching(
        /^MODEL\s+INPUT\s+OUTPUT\s+CACHE WRITE\s+CACHE READ\s+TOTAL$/
      )
    )
    expect(tty.split('\n').find(l => l.startsWith('claude-opus'))).toMatch(
      /^claude-opus\s+0\s+1,234,567\s+0\s+0\s+1,234,567$/
    )
    // Piped: title line, no header, TAB-separated plain integers.
    const lines = out.split('\n')
    const i = lines.indexOf('By model')
    expect(i).toBeGreaterThan(-1)
    expect(lines[i + 1]).toBe('claude-opus\t0\t1234567\t0\t0\t1234567')
    expect(lines).not.toContainEqual(expect.stringMatching(/^MODEL\s/))
  })

  it('By member shows a summary row then one row per model with every token kind', () => {
    const splitMembers: ReportResponseDto['byMember'] = [
      {
        memberId: 'm1',
        label: 'Alice',
        tokens: {
          input: 11,
          output: 2200,
          cacheRead: 330000,
          cacheCreation: 44000,
          total: 376211,
        },
        byModel: [
          {
            model: 'claude-opus',
            input: 10,
            output: 2000,
            cacheRead: 300000,
            cacheCreation: 40000,
            total: 342010,
          },
          {
            model: 'claude-sonnet',
            input: 1,
            output: 200,
            cacheRead: 30000,
            cacheCreation: 4000,
            total: 34201,
          },
        ],
        sessions: 3,
        unmeteredSessions: 0,
        completedCount: 2,
      },
    ]
    const split = formatReport(
      {
        ...data,
        byMember: splitMembers,
      },
      { window: win({}), tty: false }
    )
    const lines = split.split('\n')
    expect(lines).not.toContainEqual(expect.stringMatching(/^MEMBER\s/))
    const i = lines.findIndex(l => l.startsWith('Alice'))
    expect(lines[i]).toBe('Alice\t-\t-\t-\t-\t376211\t3\t2')
    expect(lines[i + 1]).toBe(
      'Alice/claude-opus\t10\t2000\t40000\t300000\t342010\t-\t-'
    )
    expect(lines[i + 2]).toBe(
      'Alice/claude-sonnet\t1\t200\t4000\t30000\t34201\t-\t-'
    )
    // On a TTY: header row, `↳` child rows with thousands separators.
    const ttyLines = formatReport(
      { ...data, byMember: splitMembers },
      { window: win({}), tty: true, width: 200 }
    ).split('\n')
    expect(ttyLines).toContainEqual(
      expect.stringMatching(
        /^MEMBER\s+INPUT\s+OUTPUT\s+CACHE WRITE\s+CACHE READ\s+TOTAL\s+SESSIONS\s+DONE$/
      )
    )
    const j = ttyLines.findIndex(l => l.startsWith('Alice'))
    expect(ttyLines[j]).toMatch(/^Alice\s+376,211\s+3\s+2$/)
    expect(ttyLines[j + 1]).toMatch(
      /^\s+↳ claude-opus\s+10\s+2,000\s+40,000\s+300,000\s+342,010$/
    )
    expect(ttyLines[j + 2]).toMatch(
      /^\s+↳ claude-sonnet\s+1\s+200\s+4,000\s+30,000\s+34,201$/
    )
  })

  it('renders a payload from an older server without byMember[].byModel', () => {
    const old = formatReport(
      {
        ...data,
        byMember: data.byMember.map(({ byModel: _drop, ...m }) => m),
      },
      { window: win({}) }
    )
    expect(old).toMatch(/^Alice\t-\t-\t-\t-\t1000000\t3 \(1 unmetered\)\t1$/m)
    expect(old).not.toContain('↳')
    expect(old).not.toContain('Alice/')
  })

  describe('token table width', () => {
    const big = {
      input: 1_111_111_111,
      output: 2_222_222_222,
      cacheRead: 3_333_333_333,
      cacheCreation: 4_444_444_444,
      total: 11_111_111_110,
    }
    const wide: ReportResponseDto = {
      ...data,
      team: { ...data.team, byModel: [{ model: 'claude-opus-4-5', ...big }] },
      byMember: [
        {
          memberId: 'm1',
          label: 'Alice',
          tokens: big,
          byModel: [{ model: 'claude-opus-4-5', ...big }],
          sessions: 3,
          unmeteredSessions: 0,
          completedCount: 1,
        },
      ],
    }
    const tables = (s: string) =>
      s.slice(s.indexOf('By model'), s.indexOf('Completed tasks')).split('\n')
    const COMPACT = /\b\d+(\.\d)?[KMBT]\b/

    it('never abbreviates when piped (non-TTY), even past the width', () => {
      const piped = formatReport(wide, {
        window: win({}),
        tty: false,
        width: 60,
      })
      // Piped figures are plain integers (no separators, no compact units).
      expect(piped).toContain('\t11111111110')
      expect(piped).toContain('\t4444444444')
      expect(tables(piped).join('\n')).not.toMatch(COMPACT)
      expect(piped).not.toContain('--json')
    })

    it('keeps exact figures on a TTY wide enough', () => {
      const ok = formatReport(wide, { window: win({}), tty: true, width: 200 })
      expect(ok).toContain('11,111,111,110')
      expect(ok).not.toContain('--json')
    })

    it('switches to compact units on an overflowing TTY and says where exact values are', () => {
      const narrow = formatReport(wide, {
        window: win({}),
        tty: true,
        width: 90,
      })
      const t = tables(narrow)
      expect(t.join('\n')).toMatch(
        /claude-opus-4-5\s+1\.1B\s+2\.2B\s+4\.4B\s+3\.3B\s+11\.1B/
      )
      expect(t.join('\n')).not.toContain('11,111,111,110')
      for (const l of t) expect(l.length).toBeLessThanOrEqual(90)
      expect(narrow).toMatch(/exact.*--json/)
    })

    it('cuts the model / member column when compact units alone still overflow', () => {
      const tight = formatReport(wide, {
        window: win({}),
        tty: true,
        width: 76,
      })
      const t = tables(tight)
      for (const l of t) expect(l.length).toBeLessThanOrEqual(76)
      expect(t.join('\n')).toContain('…')
      expect(t.join('\n')).toMatch(/1\.1B\s+2\.2B\s+4\.4B\s+3\.3B\s+11\.1B/)
      expect(tight).toMatch(/exact.*--json/)
    })

    it('never cuts the label column below 12 columns, even if rows still overflow', () => {
      const tiny = formatReport(wide, {
        window: win({}),
        tty: true,
        width: 40,
      })
      const t = tables(tiny)
      const sub = t.find(l => l.includes('↳'))!
      // "  ↳ claude-opus-4-5" cut to exactly 12 display columns.
      expect(sub.startsWith('  ↳ claude-…')).toBe(true)
      expect(sub.slice(0, 12)).toBe('  ↳ claude-…')
      expect(
        t.find(l => l.startsWith('claude-'))!.startsWith('claude-opus… ')
      ).toBe(true)
      expect(tiny).toMatch(/exact.*--json/)
    })
  })

  it('lists completed tasks with local done day and assignee, sanitized, with truncation note', () => {
    expect(out).toContain('\nCompleted tasks (3)\n')
    expect(out).toContain('\nShowing 1-2 of 3.\nAll rows: add --limit 3')
    expect(out).toContain('LUM-2\t2026-10-12\tAlice\tShip report')
    expect(out).toMatch(/LUM-1\t2026-10-08\t-\tEvil/)
    expect(out).not.toContain('\u001b')
  })

  it('prints the task-list header only on a TTY', () => {
    const tty = formatReport(data, { window: win({}), tty: true, width: 40 })
    expect(tty).toMatch(/^ID\s+DONE\s+ASSIGNEE\s+TITLE$/m)
    const piped = formatReport(data, { window: win({}), tty: false })
    expect(piped).not.toMatch(/^ID\s+DONE/m)
    expect(piped).toContain('Ship report')
  })

  it('renders an explicit empty state', () => {
    const empty = formatReport(
      {
        ...data,
        team: {
          tokens: tokens(0),
          sessions: 0,
          unmeteredSessions: 0,
          completedCount: 0,
          byModel: [],
        },
        byMember: [],
        completedTasks: { total: 0, items: [] },
      },
      { window: win({}), memberLabel: 'Alice', project: 'Lumo' }
    )
    expect(empty.split('\n')[0]).toContain('· member Alice · project Lumo')
    expect(empty).toMatch(/Tokens:\s+none recorded in this window/)
    expect(empty).toContain('No tasks completed in this window.')
    expect(empty).not.toContain('By member')
  })

  // LUM-1116: usage recorded without a session id has tokens but 0 sessions.
  it('shows tokens recorded with no session instead of "none recorded"', () => {
    const noSession = formatReport(
      {
        ...data,
        team: {
          tokens: tokens(4200),
          sessions: 0,
          unmeteredSessions: 0,
          completedCount: 0,
          byModel: [{ model: 'claude-opus', ...tokens(4200) }],
        },
      },
      { window: win({}) }
    )
    expect(noSession).toMatch(/Tokens:\s+4\.2K \(input 0 · output 4\.2K/)
    expect(noSession).not.toContain('none recorded')
  })
})

describe('report()', () => {
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance
  let fetchMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockRead.mockReturnValue({
      token: 't',
      apiUrl: 'https://x',
      email: 'me@x.com',
      workspaceSlug: 'lumo',
    })
    fetchMock = jest.fn(async (url: string) => {
      if (url.includes('/api/workspaces/members')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            members: [
              { id: 'm1', name: 'Me', email: 'me@x.com' },
              { id: 'm2', name: 'Bob', email: 'bob@x.com' },
            ],
          }),
        }
      }
      return { ok: true, status: 200, json: async () => data }
    })
    global.fetch = fetchMock as unknown as typeof fetch
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('--json prints the versioned payload unchanged', async () => {
    expect(await report({ json: true })).toBeUndefined()
    const printed = JSON.parse(logSpy.mock.calls[0][0])
    expect(printed).toEqual(data)
    // LUM-1123: the per-member model split passes through.
    expect(printed.byMember[0].byModel).toEqual([
      { model: 'claude-opus', ...tokens(1000000) },
    ])
    expect(printed.version).toBe(1)
    expect(Object.keys(printed)).toEqual([
      'version',
      'window',
      'filter',
      'team',
      'byMember',
      'completedTasks',
    ])
  })

  it('sends the local-day window and --member me as the caller member id', async () => {
    await report({ member: 'me', since: '30d', project: 'Lumo', limit: '5' })
    const reportUrl = new URL(
      fetchMock.mock.calls[fetchMock.mock.calls.length - 1]![0] as string
    )
    expect(reportUrl.pathname).toBe('/api/report')
    expect(reportUrl.searchParams.get('member')).toBe('m1')
    expect(reportUrl.searchParams.get('project')).toBe('Lumo')
    expect(reportUrl.searchParams.get('limit')).toBe('5')
    const since = new Date(reportUrl.searchParams.get('since')!)
    const until = new Date(reportUrl.searchParams.get('until')!)
    expect(Math.round((until.getTime() - since.getTime()) / 86_400_000)).toBe(
      30
    )
  })

  it('fails without calling the report API on an unknown member', async () => {
    expect(await report({ member: 'nobody' })).toBe(1)
    expect(errorSpy.mock.calls[0][0]).toContain('no member matches')
    expect(
      fetchMock.mock.calls.some(c => String(c[0]).includes('/api/report'))
    ).toBe(false)
  })

  it('rejects a bad --limit / --since before any network call', async () => {
    expect(await report({ limit: '0' })).toBe(2)
    expect(await report({ since: 'soon' })).toBe(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces the server error message', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Window too wide (max 366 days)' }),
    })
    expect(await report({})).toBe(1)
    expect(errorSpy.mock.calls[0][0]).toBe(
      'Error: report failed (HTTP 400): Window too wide (max 366 days)'
    )
  })
})
