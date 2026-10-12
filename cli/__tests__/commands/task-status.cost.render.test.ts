import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '../../src/commands/task-status'

/** LUM-733: the dashboard sections (cost, struggle/rework trail, trend) only
 *  render under `--full`; the default report is the slim agent self-check. */
const FULL = { full: true } as const

/** A minimal v2 status payload with a cost block. Override `cost` per test. */
function withCost(
  cost: TaskStatusResponse['cost'],
  over: Partial<TaskStatusResponse> = {}
): TaskStatusResponse {
  return {
    version: 2,
    task: {
      id: 't1',
      identifier: 'LUM-560',
      title: 'demo',
      status: 'IN_REVIEW',
    },
    // Omit the key entirely when undefined — exactOptional forbids an
    // explicit `cost: undefined`.
    ...(cost !== undefined ? { cost } : {}),
    struggleTrail: { pullRequests: [], reopens: [] },
    nextActions: [],
    ...over,
  }
}

describe('task status cost render (LUM-560)', () => {
  it('renders the cost section with token and active time', () => {
    const out = formatTaskStatus(
      withCost({ tokenCost: 1_200_000, activeTimeSec: 8040 }),
      FULL
    )
    expect(out).toMatch(/^Cost$/m)
    expect(out).toMatch(/^ {2}Tokens: +1\.2M$/m)
    // 8040s = 2h 14m of non-idle time.
    expect(out).toMatch(/^ {2}Active time: +2h 14m \(non-idle\)$/m)
    expect(out).not.toContain('Rework rounds')
  })

  it('renders an explicit not-recorded line when token cost is null', () => {
    const out = formatTaskStatus(
      withCost({ tokenCost: null, activeTimeSec: 0 }),
      FULL
    )
    expect(out).toMatch(
      /^ {2}Tokens: +not recorded \(no session usage captured\)$/m
    )
    // Must NOT print a fake "0" token figure for an unmeasured cost.
    expect(out).not.toMatch(/Tokens:\s*0\b/)
  })

  it('renders a measured zero token cost as 0, not as not-recorded', () => {
    const out = formatTaskStatus(
      withCost({ tokenCost: 0, activeTimeSec: 5 }),
      FULL
    )
    expect(out).toMatch(/^ {2}Tokens: +0$/m)
    expect(out).not.toContain('not recorded')
  })

  it('omits the cost section entirely when the server did not emit it', () => {
    const out = formatTaskStatus(withCost(undefined), FULL)
    expect(out).not.toMatch(/^Cost$/m)
  })
})
