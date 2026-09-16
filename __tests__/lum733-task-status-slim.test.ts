/**
 * LUM-733: `lumo task status` is the agent's self-check. By default it prints
 * only the core — criteria with verdicts, next actions, open crossings — and
 * leaves the dashboard sections (verification rollup, history, cost, struggle
 * trail, trend) to `--full`. The claim / faithfulness columns are no longer
 * rendered in the terminal at all.
 */
import {
  formatTaskStatus,
  type TaskStatusResponse,
} from '@/cli/src/commands/task-status'

const PAYLOAD: TaskStatusResponse = {
  version: 1,
  task: {
    id: 't-1',
    identifier: 'LUM-9',
    title: 'do the thing',
    status: 'IN_PROGRESS',
  },
  currentRound: 2,
  maxRounds: 3,
  escalated: false,
  criteria: [
    {
      id: 'c-1',
      statement: 'route rejects bad input',
      verifierType: 'MACHINE',
      checkpointer: 'npx jest x.test.ts',
      evidenceRequired: false,
      judgeSteps: null,
      source: 'AGENT_DRAFT',
      addedAtRound: 0,
      verdictStale: false,
      checkMismatch: false,
      machinePassed: true,
      confirmedAt: '2026-06-01T00:00:00Z',
      latestVerdict: {
        round: 2,
        verdict: 'PASS',
        evidencePointer: 'cmd:npx jest x.test.ts#exit=0',
        rejectionReason: null,
        rejectionReasonEnum: null,
        recordedAt: '2026-09-03T10:00:00.000Z',
      },
    },
    {
      id: 'c-2',
      statement: 'migration applies cleanly',
      verifierType: 'MACHINE',
      checkpointer: 'npx jest y.test.ts',
      evidenceRequired: false,
      judgeSteps: null,
      source: 'AGENT_DRAFT',
      addedAtRound: 0,
      verdictStale: false,
      checkMismatch: false,
      machinePassed: false,
      confirmedAt: '2026-06-01T00:00:00Z',
      latestVerdict: {
        round: 2,
        verdict: 'FAIL',
        evidencePointer: null,
        rejectionReason: '3 tests failed',
        rejectionReasonEnum: 'CRITERION_UNMET',
        recordedAt: '2026-09-03T10:00:00.000Z',
      },
    },
  ],
  machineVerification: { total: 2, machineVerified: 1, humanOverridden: 0 },
  cost: { tokenCost: 12_000, activeTimeSec: 900, reworkRounds: 1 },
  struggleTrail: {
    reworkRounds: [{ round: 1, failed: 1 }],
    sendBacks: [],
    followUps: [],
    pullRequests: [],
    reopens: [],
  },
  trend: {
    passRate: [
      { round: 1, passed: 1, failed: 1 },
      { round: 2, passed: 1, failed: 1 },
    ],
    cost: [
      {
        sessionId: 's-1',
        total: 12_000,
        loopCount: 3,
        at: '2026-09-03T09:00:00.000Z',
      },
    ],
    rework: { reworkRounds: 1, reopens: 0, extraPrCycles: 0, total: 1 },
  },
  claim: { text: 'I implemented X because Y', source: 'AGENT' },
  faithfulness: {
    state: 'FAITHFUL',
    verdict: 'FAITHFUL',
    evidence: [],
    reasoning: null,
    diffShas: [],
    prNumbers: [],
    judgedAt: null,
    judgedClaimAt: null,
  },
  verificationHistory: [
    { round: 1, recordedAt: '2026-09-03T09:00:00.000Z', passed: 1, failed: 1 },
    { round: 2, recordedAt: '2026-09-03T10:00:00.000Z', passed: 1, failed: 1 },
  ],
  lastRoundFailures: [
    {
      criterionId: 'c-2',
      statement: 'migration applies cleanly',
      rejectionReason: '3 tests failed',
      rejectionReasonEnum: 'CRITERION_UNMET',
    },
  ],
  nextActions: [
    {
      criterionId: 'c-2',
      statement: 'migration applies cleanly',
      verifierType: 'MACHINE',
      checkpointer: 'npx jest y.test.ts',
      judgeSteps: null,
      source: 'AGENT_DRAFT',
      addedAtRound: 0,
      rejectionReason: '3 tests failed',
    },
  ],
}

const DASHBOARD_HEADINGS = [
  'Verification:',
  'History:',
  'Cost:',
  'Struggle / rework / outstanding:',
  'Trend',
]
const CLAIM_HEADINGS = [
  'Claim vs verification:',
  'Faithfulness',
  'I implemented X because Y',
]

describe('LUM-733 task status slim default', () => {
  it('LUM-733 task status default omits dashboard sections and --full restores them', () => {
    const slim = formatTaskStatus(PAYLOAD)
    // The core is always there.
    expect(slim).toContain('LUM-9  do the thing')
    expect(slim).toContain('verification round 2/3')
    expect(slim).toContain('Criteria (2 total, 1 unmet):')
    expect(slim).toContain('✓ PASS@r2 · machine-verified')
    expect(slim).toContain('✗ FAIL@r2 — 3 tests failed')
    expect(slim).toContain('Last round (r2) failures:')
    expect(slim).toContain('Next actions (1 unmet):')
    // The dashboard sections are not.
    for (const h of DASHBOARD_HEADINGS) expect(slim).not.toContain(h)

    const full = formatTaskStatus(PAYLOAD, { full: true })
    for (const h of DASHBOARD_HEADINGS) expect(full).toContain(h)
    expect(full).toContain(
      '1 machine-verified / 0 human override (of 2 MACHINE criteria)'
    )
    expect(full).toContain('r1 · 2026-09-03T09:00:00.000Z · 1 PASS / 1 FAIL')

    // The claim / faithfulness columns are gone from BOTH renderings.
    for (const h of CLAIM_HEADINGS) {
      expect(slim).not.toContain(h)
      expect(full).not.toContain(h)
    }
  })

  it('open crossings still render by default (safety block is core)', () => {
    const out = formatTaskStatus(PAYLOAD, {
      openCrossings: {
        status: 'ok',
        gateEnabled: true,
        crossings: [
          {
            id: 'x-1',
            category: 'HARDCODED_SECRET',
            severity: 'HIGH',
            detail: 'AWS key in config.ts',
            attribution: {
              workspaceMemberId: null,
              sessionId: null,
              agent: null,
              worktreeBranch: null,
              model: null,
            },
            advisory: false,
            blocking: true,
            rejudge: null,
          },
        ],
      },
      dispositionUrl: 'https://example.test/LUM-9#boundary-crossings',
    })
    expect(out).toContain(
      'Open boundary crossings (1 undispositioned: 1 blocking DONE, 0 advisory / non-blocking)'
    )
    expect(out).toContain('[HIGH] HARDCODED_SECRET')
  })
})
