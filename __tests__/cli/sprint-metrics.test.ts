/**
 * @jest-environment node
 */
import {
  burnupPlan,
  burnupSparkline,
  fmtTaskCount,
  isSprintBurnupData,
  isSprintTeamPerformanceData,
  sprintBurnupLines,
  sprintTeamPerformanceLines,
  type SprintBurnupData,
  type SprintTeamPerformanceData,
} from '@/cli/src/lib/sprint-metrics'
import {
  fetchSecondary,
  formatSprintShow,
} from '@/cli/src/commands/sprint-show'

// LUM-1190 — `sprint show` Burnup + Team performance sections.

const burnup: SprintBurnupData = {
  start: '2026-06-01',
  end: '2026-06-05',
  scopeTotal: 4,
  series: [
    { date: '2026-06-01', scope: 3, completed: 0 },
    { date: '2026-06-02', scope: 4, completed: 1 },
    { date: '2026-06-03', scope: 4, completed: 2 },
    { date: '2026-06-04', scope: 4, completed: null },
    { date: '2026-06-05', scope: 4, completed: null },
  ],
}

const perf: SprintTeamPerformanceData = {
  measuredTasks: 3,
  totalTokenCost: 4_000_000,
  totalActiveTimeSec: 5_400,
  totalRuns: 6,
  rows: [
    {
      memberId: 'm1',
      label: 'Alice',
      tasksDone: 2,
      tokenCost: 3_000_000,
      activeTimeSec: 3_600,
      runs: 4,
      perTask: [
        {
          identifier: 'LUM-1',
          title: 'Fix login',
          tokenCost: 3_000_000,
          activeTimeSec: 3_600,
          models: [{ model: 'claude-opus-5', total: 2_500_000 }],
          updatedAt: '2026-06-03T12:00:00.000Z',
        },
      ],
    },
    {
      memberId: null,
      label: null,
      tasksDone: 1,
      tokenCost: 1_000_000,
      activeTimeSec: 1_800,
      runs: 2,
      perTask: [],
    },
  ],
}

describe('burnup helpers', () => {
  it('plans a straight line from 0 to the scope', () => {
    expect([0, 1, 2, 3, 4].map(i => burnupPlan(4, i, 5))).toEqual([
      0, 1, 2, 3, 4,
    ])
    expect(burnupPlan(3, 1, 4)).toBe(1)
    expect(burnupPlan(5, 0, 1)).toBe(5)
  })

  it('prints whole tasks bare and plan halves with one decimal', () => {
    expect(fmtTaskCount(3)).toBe('3')
    expect(fmtTaskCount(2.5)).toBe('2.5')
    expect(fmtTaskCount(1 / 3)).toBe('0.3')
  })

  it('draws one char per day, `·` for days not measured yet', () => {
    expect(burnupSparkline(burnup.series, 4)).toBe('▁▃▅··')
  })
})

describe('sprintBurnupLines', () => {
  it('renders done-as-of, the trend and a per-day table with a header', () => {
    const out = sprintBurnupLines(burnup).join('\n')
    expect(out).toContain('\nBurnup\n')
    expect(out).toContain('Done:   2 / 4  (as of 2026-06-03)')
    expect(out).toContain('Trend:  ▁▃▅··  (2026-06-01 → 2026-06-05)')
    expect(out).toMatch(/DAY +SCOPE +DONE +PLAN/)
    expect(out).toMatch(/2026-06-01 +3 +0 +0/)
    expect(out).toMatch(/2026-06-03 +4 +2 +2/)
    // Future days of an ACTIVE sprint: done reads `-`, never 0.
    expect(out).toMatch(/2026-06-05 +4 +- +4/)
  })

  it('says so when there is no series', () => {
    const out = sprintBurnupLines({ ...burnup, series: [] }).join('\n')
    expect(out).toContain('Burnup\n  Not enough data yet.')
  })

  it('reports a failed read instead of omitting the section', () => {
    const out = sprintBurnupLines({ error: 'HTTP 500' }).join('\n')
    expect(out).toContain('Burnup\n  Could not read (HTTP 500).')
  })

  it('renders nothing when not fetched', () => {
    expect(sprintBurnupLines(undefined)).toEqual([])
  })
})

describe('sprintTeamPerformanceLines', () => {
  it('renders totals, one block per member and their tasks', () => {
    const out = sprintTeamPerformanceLines(perf).join('\n')
    expect(out).toContain('\nTeam performance\n')
    expect(out).toContain(
      'Total:  4M tokens · 1h 30m agent time · 6 runs  (measured on 3 tasks)'
    )
    expect(out).toContain(
      '  Alice  75% · 2 tasks done · 3M tokens · 1h agent time · 4 runs'
    )
    expect(out).toMatch(
      /\n {4}LUM-1 +3M tokens +1h +2026-06-0\d +Fix login +claude-opus-5 2\.5M · 500K not attributed to a model/
    )
    expect(out).toContain(
      '  Unattributed  25% · 1 task done · 1M tokens · 30m agent time · 2 runs'
    )
  })

  it('reads `-` for tokens and share when the token side is unmeasured', () => {
    const out = sprintTeamPerformanceLines({
      ...perf,
      totalTokenCost: null,
      rows: perf.rows.map(r => ({
        ...r,
        tokenCost: 0,
        perTask: r.perTask.map(t => ({ ...t, tokenCost: 0, models: [] })),
      })),
    }).join('\n')
    expect(out).toContain('Total:  - tokens')
    expect(out).toContain('  Alice  - · 2 tasks done · - tokens')
    expect(out).toMatch(/LUM-1 +- tokens +1h +\S+ +Fix login/)
    expect(out).not.toContain('0 tokens')
    expect(out).not.toContain('0%')
  })

  it("lists a member's top five tasks and counts the rest", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      identifier: `LUM-${10 + i}`,
      title: `Task ${i}`,
      tokenCost: 1_000 * (7 - i),
      activeTimeSec: 60,
      models: [],
      updatedAt: '2026-06-03T12:00:00.000Z',
    }))
    const out = sprintTeamPerformanceLines({
      ...perf,
      rows: [{ ...perf.rows[0]!, perTask: many }],
    }).join('\n')
    expect(out).toContain('LUM-14')
    expect(out).not.toContain('LUM-15')
    expect(out).toContain('    … 2 more tasks')
  })

  it('cuts member and task lines to the width on a TTY only', () => {
    const long = {
      ...perf,
      rows: [
        {
          ...perf.rows[0]!,
          perTask: [{ ...perf.rows[0]!.perTask[0]!, title: 'x'.repeat(200) }],
        },
      ],
    }
    const tty = sprintTeamPerformanceLines(long, { tty: true, width: 60 })
    expect(Math.max(...tty.map(l => l.length))).toBeLessThanOrEqual(60)
    const piped = sprintTeamPerformanceLines(long, { width: 60 }).join('\n')
    expect(piped).toContain('x'.repeat(200))
  })

  it('says so when nobody spent anything', () => {
    const out = sprintTeamPerformanceLines({ ...perf, rows: [] }).join('\n')
    expect(out).toContain('None — no agent work recorded on this sprint.')
  })

  it('reports a failed read', () => {
    expect(
      sprintTeamPerformanceLines({ error: 'HTTP 404' }).join('\n')
    ).toContain('Could not read (HTTP 404).')
  })
})

describe('formatSprintShow — metrics sections', () => {
  const sprint = {
    id: 'sp-1',
    number: 3,
    name: 'Sprint 3',
    status: 'ACTIVE',
    startDate: '2026-06-01T00:00:00.000Z',
    endDate: '2026-06-05T00:00:00.000Z',
    startedAt: null,
    closedAt: null,
    team: { id: 't-1', name: 'Engineering' },
  }

  it('places Burnup and Team performance before the task table', () => {
    const out = formatSprintShow(
      sprint,
      { done: 2, total: 4 },
      [],
      undefined,
      {},
      {
        burnup,
        teamPerformance: perf,
      }
    )
    const b = out.indexOf('\nBurnup\n')
    const t = out.indexOf('\nTeam performance\n')
    const tasks = out.indexOf('\nTasks (0)\n')
    expect(b).toBeGreaterThan(-1)
    expect(t).toBeGreaterThan(b)
    expect(tasks).toBeGreaterThan(t)
  })

  it('is unchanged without metrics', () => {
    const out = formatSprintShow(sprint, { done: 2, total: 4 }, [])
    expect(out).not.toContain('Burnup')
    expect(out).not.toContain('Team performance')
  })
})

describe('response-shape guards', () => {
  it('accept the payloads the renderers read', () => {
    expect(isSprintBurnupData(burnup)).toBe(true)
    expect(isSprintTeamPerformanceData(perf)).toBe(true)
    expect(isSprintTeamPerformanceData({ ...perf, totalTokenCost: null })).toBe(
      true
    )
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['an error body', { error: 'Sprint not found' }],
    ['series not an array', { ...burnup, series: 'x' }],
    [
      'a day with a string count',
      { ...burnup, series: [{ date: '2026-06-01', scope: '3', completed: 0 }] },
    ],
    ['missing scopeTotal', { start: 'a', end: 'b', series: [] }],
  ])('burnup guard rejects %s', (_label, body) => {
    expect(isSprintBurnupData(body)).toBe(false)
  })

  it.each([
    ['null', null],
    ['rows missing', { ...perf, rows: undefined }],
    [
      'a row without perTask',
      { ...perf, rows: [{ ...perf.rows[0]!, perTask: null }] },
    ],
    [
      'a task with non-array models',
      {
        ...perf,
        rows: [
          {
            ...perf.rows[0]!,
            perTask: [{ ...perf.rows[0]!.perTask[0]!, models: {} }],
          },
        ],
      },
    ],
    ['a string total', { ...perf, totalTokenCost: '4M' }],
  ])('team-performance guard rejects %s', (_label, body) => {
    expect(isSprintTeamPerformanceData(body)).toBe(false)
  })
})

describe('fetchSecondary', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })
  const ok = (body: unknown) =>
    jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    }) as unknown as typeof fetch

  it('returns a valid body, sent with a bearer header', async () => {
    const fetchMock = ok(burnup)
    global.fetch = fetchMock
    await expect(
      fetchSecondary('http://x/api', 'tok', isSprintBurnupData)
    ).resolves.toEqual(burnup)
    expect(fetchMock).toHaveBeenCalledWith('http://x/api', {
      headers: { Authorization: 'Bearer tok' },
    })
  })

  it('turns a malformed body into a ReadFailure', async () => {
    global.fetch = ok({ series: 'nope' })
    await expect(
      fetchSecondary('http://x', 't', isSprintBurnupData)
    ).resolves.toEqual({ error: 'unexpected response shape' })
  })

  it('turns an unparsable body into a ReadFailure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    }) as unknown as typeof fetch
    await expect(
      fetchSecondary('http://x', 't', isSprintBurnupData)
    ).resolves.toEqual({ error: 'Unexpected token < in JSON' })
  })

  it('turns a non-2xx or a network error into a ReadFailure', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch
    await expect(
      fetchSecondary('http://x', 't', isSprintBurnupData)
    ).resolves.toEqual({ error: 'HTTP 503' })
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch
    await expect(
      fetchSecondary('http://x', 't', isSprintTeamPerformanceData)
    ).resolves.toEqual({ error: 'ECONNREFUSED' })
  })

  it('a malformed section renders the Could-not-read line', () => {
    expect(
      sprintBurnupLines({ error: 'unexpected response shape' }).join('\n')
    ).toContain('Burnup\n  Could not read (unexpected response shape).')
  })
})
