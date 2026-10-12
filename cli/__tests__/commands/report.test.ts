/**
 * @jest-environment node
 *
 * LUM-1100 — `lumo report`: window resolution, rendering (data + empty
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
      sessions: 3,
      unmeteredSessions: 1,
      completedCount: 1,
    },
    {
      memberId: null,
      label: '(unassigned)',
      tokens: tokens(0),
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
    expect(out).toMatch(/Tokens:\s+1,234,567 \(output 1,234,567/)
    expect(out).toContain(
      '5 (2 unmetered — no token usage recorded, not counted as 0)'
    )
    expect(out).toMatch(/Completed:\s+2 tasks/)
  })

  it('splits tokens and completed counts per member', () => {
    const alice = out.split('\n').find(l => l.startsWith('Alice'))
    expect(alice).toMatch(/Alice\s+1,000,000\s+3 \(1 unmetered\)\s+1$/)
    const unassigned = out.split('\n').find(l => l.startsWith('(unassigned)'))
    expect(unassigned).toMatch(/—\s+0\s+1$/)
  })

  it('lists completed tasks with local done day and assignee, sanitized, with truncation note', () => {
    expect(out).toContain(
      'Completed tasks (showing 2 of 3; raise --limit for more)'
    )
    expect(out).toMatch(/LUM-2\s+2026-10-12\s+Alice\s+Ship report/)
    expect(out).toMatch(/LUM-1\s+2026-10-08\s+—\s+Evil/)
    expect(out).not.toContain('\u001b')
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
    expect(await report({ limit: '0' })).toBe(1)
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
