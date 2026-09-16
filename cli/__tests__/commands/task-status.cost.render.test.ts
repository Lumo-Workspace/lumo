import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '../../src/commands/task-status'

/** LUM-733: the dashboard sections (cost, struggle/rework trail, trend) only
 *  render under `--full`; the default report is the slim agent self-check. */
const FULL = { full: true } as const

/** A minimal status payload with a cost block — one clean MACHINE criterion.
 *  Override `cost` per test. */
function withCost(
  cost: TaskStatusResponse['cost'],
  over: Partial<TaskStatusResponse> = {}
): TaskStatusResponse {
  return {
    version: 1,
    task: {
      id: 't1',
      identifier: 'LUM-560',
      title: 'demo',
      status: 'IN_REVIEW',
    },
    currentRound: 1,
    maxRounds: 3,
    escalated: false,
    criteria: [
      {
        id: 'c-1',
        statement: 'does the thing',
        verifierType: 'MACHINE',
        checkpointer: 'npx jest x',
        evidenceRequired: false,
        judgeSteps: null,
        source: 'AGENT_DRAFT',
        addedAtRound: 0,
        verdictStale: false,
        checkMismatch: false,
        machinePassed: true,
        confirmedAt: '2026-06-01T00:00:00Z',
        latestVerdict: {
          round: 1,
          verdict: 'PASS',
          evidencePointer: 'cmd:npx jest x#exit=0',
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: '2026-06-02T10:00:00Z',
        },
        sendBackResolution: null,
      },
    ],
    machineVerification: { total: 1, machineVerified: 1, humanOverridden: 0 },
    // Omit the key entirely when undefined (an older server) — exactOptional
    // forbids an explicit `cost: undefined`.
    ...(cost !== undefined ? { cost } : {}),
    struggleTrail: {
      reworkRounds: [],
      sendBacks: [],
      followUps: [],
      pullRequests: [],
      reopens: [],
    },
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  }
}

describe('task status cost render (LUM-560)', () => {
  it('renders the cost section with token / active time / rework rounds', () => {
    const out = formatTaskStatus(
      withCost({ tokenCost: 1_200_000, activeTimeSec: 8040, reworkRounds: 2 }),
      FULL
    )
    expect(out).toContain('Cost:')
    expect(out).toContain('Tokens: 1.2M')
    // 8040s = 2h 14m of non-idle time.
    expect(out).toContain('Active time: 2h 14m (non-idle)')
    expect(out).toContain('Rework rounds: 2')
  })

  it('renders an explicit not-recorded line when token cost is null', () => {
    const out = formatTaskStatus(
      withCost({ tokenCost: null, activeTimeSec: 0, reworkRounds: 0 }),
      FULL
    )
    expect(out).toContain('Tokens: not recorded (no session usage captured)')
    // A measured-zero rework count is annotated, never left ambiguous.
    expect(out).toContain('Rework rounds: 0 (no machine rework)')
    // Must NOT print a fake "0" token figure for an unmeasured cost.
    expect(out).not.toMatch(/Tokens:\s*0\b/)
  })

  it('renders a measured zero token cost as 0, not as not-recorded', () => {
    const out = formatTaskStatus(
      withCost({ tokenCost: 0, activeTimeSec: 5, reworkRounds: 0 }),
      FULL
    )
    expect(out).toContain('Tokens: 0')
    expect(out).not.toContain('not recorded')
  })

  it('omits the cost section entirely when the server did not emit it (older server)', () => {
    const out = formatTaskStatus(withCost(undefined), FULL)
    expect(out).not.toContain('Cost:')
  })
})
