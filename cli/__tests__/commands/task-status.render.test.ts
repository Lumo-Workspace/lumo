import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '../../src/commands/task-status'

/** LUM-733: the dashboard sections (cost, struggle/rework trail, trend) only
 *  render under `--full`; the default report is the slim agent self-check. */
const FULL = { full: true } as const

/** A minimal v2 status payload — an empty struggle trail. Override per test. */
function baseResponse(
  over: Partial<TaskStatusResponse> = {}
): TaskStatusResponse {
  return {
    version: 2,
    task: {
      id: 't1',
      identifier: 'LUM-561',
      title: 'demo',
      status: 'IN_REVIEW',
    },
    struggleTrail: { pullRequests: [], reopens: [] },
    nextActions: [],
    ...over,
  }
}

describe('task status struggle/rework section', () => {
  it('LUM-561 always renders the section even on a clean task', () => {
    const out = formatTaskStatus(baseResponse(), FULL)
    expect(out).toMatch(/^Struggle \/ rework$/m)
  })

  it('LUM-561 empty trail cites its basis, not a bare nothing-outstanding', () => {
    const out = formatTaskStatus(baseResponse(), FULL)
    expect(out).toContain('None recorded — 0 PRs, no reopens.')
    expect(out).not.toMatch(/^\s*Nothing outstanding\.?\s*$/im)
  })

  it('LUM-561 pr-cycle and reopen signals surface the rework', () => {
    const out = formatTaskStatus(
      baseResponse({
        struggleTrail: {
          pullRequests: [
            { number: 654, url: 'u654' },
            { number: 657, url: 'u657' },
            { number: 660, url: 'u660' },
          ],
          reopens: [
            {
              from: 'IN_REVIEW',
              to: 'IN_PROGRESS',
              at: '2026-06-02T00:00:00Z',
            },
            { from: 'DONE', to: 'IN_PROGRESS', at: '2026-06-03T00:00:00Z' },
          ],
        },
      }),
      FULL
    )
    expect(out).not.toMatch(/None recorded/i)
    expect(out).toMatch(/3 PRs/)
    expect(out).toMatch(/#654/)
    expect(out).toMatch(/#660/)
    expect(out).toMatch(/^ {2}Reopened: +2× /m)
    expect(out).toMatch(/^ {4}IN_REVIEW → IN_PROGRESS$/m)
  })

  it('LUM-561 a single PR is the happy path and does not mark the trail non-empty', () => {
    const out = formatTaskStatus(
      baseResponse({
        struggleTrail: {
          pullRequests: [{ number: 654, url: 'u654' }],
          reopens: [],
        },
      }),
      FULL
    )
    expect(out).toContain('None recorded — 1 PR, no reopens.')
    expect(out).not.toMatch(/PR iterations/i)
  })

  it('the section is a --full dashboard section only', () => {
    expect(formatTaskStatus(baseResponse())).not.toMatch(/Struggle/)
  })
})

// LUM-562 趋势非快照: the Trend section turns the snapshot quantities into movement.
describe('task status Trend section (LUM-562)', () => {
  it('task status renders a Trend section with cost and rework movement', () => {
    const out = formatTaskStatus(
      baseResponse({
        trend: {
          cost: [
            {
              sessionId: 's-1',
              total: 4200,
              loopCount: 3,
              at: '2026-06-02T09:00:00Z',
            },
            {
              sessionId: 's-2',
              total: 1100,
              loopCount: 1,
              at: '2026-06-03T09:00:00Z',
            },
          ],
          rework: { reopens: 1, extraPrCycles: 1, total: 2 },
        },
      }),
      FULL
    )
    expect(out).toMatch(/Trend \(2 sessions\)/)
    expect(out).toMatch(/^ {2}Cost\/session: +4\.2K → 1\.1K tokens/m)
    expect(out).toMatch(/↓/)
    expect(out).toMatch(/^ {2}Total: +5\.3K tokens over 2 sessions$/m)
    expect(out).toMatch(/^ {2}Rework: +2 accrued — 1 reopen, \+1 PR cycle/m)
    expect(out).not.toMatch(/Pass rate/)
  })

  it('task status Trend states no trajectory yet on a single data point', () => {
    const out = formatTaskStatus(
      baseResponse({
        trend: {
          cost: [
            {
              sessionId: 's-1',
              total: 1100,
              loopCount: 1,
              at: '2026-06-02T09:00:00Z',
            },
          ],
          rework: { reopens: 0, extraPrCycles: 0, total: 0 },
        },
      }),
      FULL
    )
    expect(out).toMatch(/^Trend$/m)
    expect(out).toMatch(/no trajectory yet/i)
    expect(out).toMatch(/needs ≥2 sessions/i)
    // never draws a fake direction arrow off a single value
    expect(out).not.toMatch(/→ .*tokens/)
  })

  it('LUM-562 says nothing-to-trend when no cost yet', () => {
    const out = formatTaskStatus(
      baseResponse({
        trend: { cost: [], rework: { reopens: 0, extraPrCycles: 0, total: 0 } },
      }),
      FULL
    )
    expect(out).toMatch(/nothing to trend/i)
  })

  it('LUM-562 skips the Trend section entirely when the server sent no trend', () => {
    const out = formatTaskStatus(baseResponse(), FULL)
    expect(out).not.toMatch(/Trend/)
  })
})
