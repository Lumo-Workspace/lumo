import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '../../src/commands/task-status'

/** LUM-733: the dashboard sections (cost, struggle/rework trail, trend) only
 *  render under `--full`; the default report is the slim agent self-check. */
const FULL = { full: true } as const

/** A minimal all-pass status payload — one MACHINE criterion, machine-verified,
 *  one clean round, an empty struggle trail. Override per test. */
function baseResponse(
  over: Partial<TaskStatusResponse> = {}
): TaskStatusResponse {
  return {
    version: 1,
    task: {
      id: 't1',
      identifier: 'LUM-561',
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
    struggleTrail: {
      reworkRounds: [],
      sendBacks: [],
      followUps: [],
      pullRequests: [],
      reopens: [],
    },
    verificationHistory: [
      { round: 1, recordedAt: '2026-06-02T10:00:00Z', passed: 1, failed: 0 },
    ],
    lastRoundFailures: [],
    nextActions: [],
    ...over,
  }
}

describe('task status struggle/rework/outstanding section', () => {
  it('LUM-561 always renders the section even on a clean all-pass task', () => {
    const out = formatTaskStatus(baseResponse(), FULL)
    expect(out).toMatch(/Struggle \/ rework \/ outstanding/i)
  })

  it('LUM-561 empty trail after verification cites its evidence basis, not a bare nothing-outstanding', () => {
    const out = formatTaskStatus(baseResponse(), FULL)
    expect(out).toMatch(/Struggle \/ rework \/ outstanding/i)
    // The basis is explicit: rounds run + 0 FAIL + no send-backs/follow-ups.
    expect(out).toMatch(/1 verification round/i)
    expect(out).toMatch(/0 FAIL/i)
    // It must not read as the mum-and-deaf "Nothing outstanding".
    expect(out).not.toMatch(/^\s*Nothing outstanding\.?\s*$/im)
  })

  it('LUM-561 empty trail with no verification states it cannot confirm there were no difficulties', () => {
    const out = formatTaskStatus(
      baseResponse({
        currentRound: 0,
        verificationHistory: [],
        criteria: [
          {
            ...baseResponse().criteria[0]!,
            machinePassed: false,
            latestVerdict: null,
          },
        ],
        machineVerification: {
          total: 1,
          machineVerified: 0,
          humanOverridden: 0,
        },
        nextActions: [
          {
            criterionId: 'c-1',
            statement: 'does the thing',
            verifierType: 'MACHINE',
            checkpointer: 'npx jest x',
            judgeSteps: null,
            source: 'AGENT_DRAFT',
            addedAtRound: 0,
            rejectionReason: null,
          },
        ],
      }),
      FULL
    )
    expect(out).toMatch(/Struggle \/ rework \/ outstanding/i)
    expect(out).toMatch(/no verification has run/i)
    expect(out).toMatch(/cannot confirm/i)
  })

  it('LUM-561 populated trail enumerates rework rounds, send-backs and follow-ups', () => {
    const out = formatTaskStatus(
      baseResponse({
        currentRound: 2,
        struggleTrail: {
          reworkRounds: [{ round: 1, failed: 2 }],
          sendBacks: [
            {
              criterionId: 'c-x',
              statement: 'the bounced requirement',
              status: 'resolved',
              failedAtRound: 1,
              resolvedAtRound: 2,
            },
            {
              criterionId: 'c-y',
              statement: 'the still-open requirement',
              status: 'open',
              failedAtRound: 2,
              resolvedAtRound: null,
            },
          ],
          followUps: [
            { criterionId: 'c-z', statement: 'leftover refactor', round: 2 },
          ],
          pullRequests: [],
          reopens: [],
        },
      }),
      FULL
    )
    // rework round with its FAIL count
    expect(out).toMatch(/round 1.*2 FAIL/i)
    // both send-backs, with state
    expect(out).toMatch(/the bounced requirement/)
    expect(out).toMatch(/resolved/)
    expect(out).toMatch(/the still-open requirement/)
    expect(out).toMatch(/open/)
    // the leftover follow-up
    expect(out).toMatch(/leftover refactor/)
  })

  it('LUM-561 pr-cycle and reopen signals surface the rework that lives outside the verify loop', () => {
    // Mirrors LUM-557: a single clean verify round, but the work churned across
    // many PRs and got bounced after review — the section must NOT read empty.
    const out = formatTaskStatus(
      baseResponse({
        struggleTrail: {
          reworkRounds: [],
          sendBacks: [],
          followUps: [],
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
    expect(out).toMatch(/Struggle \/ rework \/ outstanding/i)
    // must not collapse to the clean-slate basis
    expect(out).not.toMatch(/None recorded/i)
    // PR iteration count + numbers
    expect(out).toMatch(/3 PRs/)
    expect(out).toMatch(/#654/)
    expect(out).toMatch(/#660/)
    // reopens
    expect(out).toMatch(/Reopened 2/i)
    expect(out).toMatch(/IN_REVIEW → IN_PROGRESS/)
  })

  it('LUM-561 a single PR is the happy path and does not by itself mark the trail non-empty', () => {
    const out = formatTaskStatus(
      baseResponse({
        struggleTrail: {
          reworkRounds: [],
          sendBacks: [],
          followUps: [],
          pullRequests: [{ number: 654, url: 'u654' }],
          reopens: [],
        },
      }),
      FULL
    )
    // one PR + clean verify round → still "None recorded" with its basis
    expect(out).toMatch(/None recorded/i)
    expect(out).not.toMatch(/PR iterations/i)
  })
})

// LUM-562 規律7: the Trend section turns the snapshot quantities into movement.
describe('task status Trend section (LUM-562)', () => {
  it('task status renders a Trend section with pass-rate cost and rework movement', () => {
    const out = formatTaskStatus(
      baseResponse({
        currentRound: 2,
        trend: {
          passRate: [
            { round: 1, passed: 3, failed: 2 },
            { round: 2, passed: 5, failed: 0 },
          ],
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
          rework: { reworkRounds: 1, reopens: 1, extraPrCycles: 1, total: 3 },
        },
      }),
      FULL
    )
    expect(out).toMatch(/Trend \(2 rounds · 2 sessions\)/)
    // pass-rate trajectory with direction
    expect(out).toMatch(/Pass rate: r1 60% → r2 100%/)
    expect(out).toMatch(/↑ \+40pts/)
    // cost trajectory with direction + total
    expect(out).toMatch(/Cost\/session: 4\.2K → 1\.1K tokens/)
    expect(out).toMatch(/↓/)
    expect(out).toMatch(/5\.3K total/)
    // rework accrual decomposed
    expect(out).toMatch(/Rework: 3 accrued/)
    expect(out).toMatch(/1 FAIL round/)
    expect(out).toMatch(/1 reopen/)
    expect(out).toMatch(/\+1 PR cycle/)
  })

  it('task status Trend states no trajectory yet on a single data point', () => {
    const out = formatTaskStatus(
      baseResponse({
        currentRound: 1,
        trend: {
          passRate: [{ round: 1, passed: 1, failed: 0 }],
          cost: [
            {
              sessionId: 's-1',
              total: 1100,
              loopCount: 1,
              at: '2026-06-02T09:00:00Z',
            },
          ],
          rework: { reworkRounds: 0, reopens: 0, extraPrCycles: 0, total: 0 },
        },
      }),
      FULL
    )
    expect(out).toMatch(/Trend:/)
    expect(out).toMatch(/no trajectory yet/i)
    expect(out).toMatch(/needs ≥2 rounds or sessions/i)
    // never draws a fake direction arrow off a single value
    expect(out).not.toMatch(/pts\)/)
    expect(out).not.toMatch(/→ .*tokens/)
  })

  it('LUM-562 says nothing-to-trend when no rounds and no cost yet', () => {
    const out = formatTaskStatus(
      baseResponse({
        currentRound: 0,
        trend: {
          passRate: [],
          cost: [],
          rework: { reworkRounds: 0, reopens: 0, extraPrCycles: 0, total: 0 },
        },
      }),
      FULL
    )
    expect(out).toMatch(/nothing to trend/i)
  })

  it('LUM-562 skips the Trend section entirely for an older server (no trend field)', () => {
    // baseResponse() omits the optional trend field — pushTrend must no-op.
    const out = formatTaskStatus(baseResponse(), FULL)
    expect(out).not.toMatch(/Trend/)
  })
})
