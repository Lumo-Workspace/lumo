import { deriveRecordGaps } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/record-gaps'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
  CriterionSource,
  AcceptanceVerdict,
} from '@/app/workspace/[workspaceUrl]/types'
import type { BoundaryCrossingView } from '@/app/workspace/[workspaceUrl]/hooks/useBoundaryCrossings'

let seq = 0

function view(
  p: Partial<TaskAcceptanceStatusView> & { criteria: TaskStatusCriterionView[] }
): TaskAcceptanceStatusView {
  return {
    version: 1,
    task: { id: 't', identifier: 'LUM-1', title: 'x', status: 'IN_REVIEW' },
    currentRound: 1,
    maxRounds: 5,
    escalated: false,
    machineVerification: { total: 0, machineVerified: 0, humanOverridden: 0 },
    removedCriteria: [],
    verificationHistory: [],
    lastRoundFailures: [],
    nextActions: [],
    ...p,
  } as TaskAcceptanceStatusView
}

// verifier defaults to MACHINE. `machinePassed` mirrors verdict-status.test.ts's
// convention: a MACHINE criterion only counts as genuinely verified when its
// verdict is PASS *and* machinePassed is left true (the default). Passing
// machinePassed: false with a PASS verdict simulates a human override — the
// honest "passing but not machine-verified" state machineRollup must count as
// awaiting, not verified.
function crit(
  v: AcceptanceVerdict | null,
  opts: { verifier?: 'MACHINE' | 'HUMAN'; machinePassed?: boolean } = {}
): TaskStatusCriterionView {
  const verifier = opts.verifier ?? 'MACHINE'
  const machinePassed =
    opts.machinePassed ?? (v === 'PASS' && verifier === 'MACHINE')
  return {
    id: `c-${seq++}`,
    statement: 's',
    verifierType: verifier,
    checkpointer: verifier === 'MACHINE' ? 'cmd:test' : null,
    evidenceRequired: false,
    judgeSteps: null,
    source: 'AGENT_DRAFT' as CriterionSource,
    addedAtRound: 0,
    latestVerdict: v
      ? {
          round: 1,
          verdict: v,
          verifierType: verifier,
          evidencePointer: null,
          rejectionReason: null,
          rejectionReasonEnum: null,
          recordedAt: 'now',
        }
      : null,
    machinePassed,
    verdictStale: false,
    checkMismatch: false,
    changeState: null,
    changedAtRound: null,
    lastEdit: null,
  }
}

let crossingSeq = 0

function crossing(p: Partial<BoundaryCrossingView> = {}): BoundaryCrossingView {
  return {
    id: `x-${crossingSeq++}`,
    category: 'other',
    detail: 'd',
    detectedAt: 'now',
    reversible: true,
    occurrenceCount: 1,
    lastSeenAt: 'now',
    severity: 'MEDIUM',
    disposition: null,
    dispositionNote: null,
    dispositionedAt: null,
    dispositionedById: null,
    remediationTask: null,
    editChange: null,
    lastDispositionChange: null,
    attribution: {
      workspaceMemberId: null,
      sessionId: null,
      agent: null,
      worktreeBranch: null,
      model: null,
    },
    explanations: [],
    advisory: false,
    policyRuleRef: null,
    policyRuleText: null,
    agentContext: null,
    systemExplanation: null,
    ...p,
  }
}

describe('deriveRecordGaps', () => {
  it('no criteria, no crossings -> all zero, canBeDone', () => {
    const g = deriveRecordGaps({
      data: view({ criteria: [] }),
      crossings: [],
      gateEnabled: true,
    })
    expect(g).toEqual({
      machineAwaiting: 0,
      machineTotal: 0,
      machineVerified: 0,
      humanPending: 0,
      humanTotal: 0,
      crossingsOpen: 0,
      crossingsBlocking: 0,
      crossingsTotal: 0,
      securityBlocking: 0,
      canBeDone: true,
      taskDone: false,
    })
  })

  // Review F3: the strip needs to know the task was accepted (to say
  // "Accepted" instead of "can be marked Done") without a second prop —
  // the same DONE flag that zeroes machineAwaiting / humanPending.
  it('taskDone mirrors data.task.status', () => {
    expect(
      deriveRecordGaps({
        data: view({ criteria: [] }),
        crossings: [],
        gateEnabled: true,
      }).taskDone
    ).toBe(false)
    expect(
      deriveRecordGaps({
        data: view({
          task: { id: 't', identifier: 'LUM-1', title: 'x', status: 'DONE' },
          criteria: [],
        }),
        crossings: [],
        gateEnabled: true,
      }).taskDone
    ).toBe(true)
  })

  it('machine: a genuine PASS counts as verified, not awaiting', () => {
    const g = deriveRecordGaps({
      data: view({ criteria: [crit('PASS'), crit('PASS')] }),
      crossings: [],
      gateEnabled: true,
    })
    expect(g.machineTotal).toBe(2)
    expect(g.machineVerified).toBe(2)
    expect(g.machineAwaiting).toBe(0)
    expect(g.canBeDone).toBe(true)
  })

  it('machine: unjudged (no verdict yet) counts as awaiting', () => {
    const g = deriveRecordGaps({
      data: view({ criteria: [crit(null)] }),
      crossings: [],
      gateEnabled: true,
    })
    expect(g.machineTotal).toBe(1)
    expect(g.machineVerified).toBe(0)
    expect(g.machineAwaiting).toBe(1)
    expect(g.canBeDone).toBe(false)
  })

  it('machine: a FAIL counts as awaiting', () => {
    const g = deriveRecordGaps({
      data: view({ criteria: [crit('FAIL')] }),
      crossings: [],
      gateEnabled: true,
    })
    expect(g.machineAwaiting).toBe(1)
    expect(g.canBeDone).toBe(false)
  })

  it('machine: a human override (PASS without a checkpointer behind it) is honest but still counts as awaiting, not verified', () => {
    const g = deriveRecordGaps({
      data: view({
        criteria: [crit('PASS', { machinePassed: false })],
      }),
      crossings: [],
      gateEnabled: true,
    })
    expect(g.machineTotal).toBe(1)
    expect(g.machineVerified).toBe(0)
    expect(g.machineAwaiting).toBe(1)
    expect(g.canBeDone).toBe(false)
  })

  it('machine: a DONE task forces awaiting to 0 while keeping verified/total honest', () => {
    // Same rule as humanPending: a closed task owes the reviewer no action, so
    // a failed (or human-carried) check must not drag it back into NEEDS
    // ACTION — but the record card still has to say 0 of 2 were machine-verified.
    const g = deriveRecordGaps({
      data: view({
        task: { id: 't', identifier: 'LUM-1', title: 'x', status: 'DONE' },
        criteria: [crit('FAIL'), crit('PASS', { machinePassed: false })],
      }),
      crossings: [],
      gateEnabled: true,
    })
    expect(g.machineTotal).toBe(2)
    expect(g.machineVerified).toBe(0)
    expect(g.machineAwaiting).toBe(0)
    expect(g.canBeDone).toBe(true)
  })

  // LUM-789: overturns the pre-existing "unjudged HUMAN criteria count as
  // pending" rule this test used to assert (title and expectations both
  // updated — a fresh, never-adjudicated HUMAN criterion is now a tacit
  // pass, matching the DONE gate itself, which only ever blocked on an
  // explicit FAIL). See the companion "explicit FAIL" case right below for
  // the direction that must still hold.
  it('human: an un-adjudicated criterion is a tacit pass — it does NOT count as pending', () => {
    const g = deriveRecordGaps({
      data: view({
        criteria: [
          crit(null, { verifier: 'HUMAN' }),
          crit('PASS', { verifier: 'HUMAN' }),
        ],
      }),
      crossings: [],
      gateEnabled: true,
    })
    expect(g.humanTotal).toBe(2)
    expect(g.humanPending).toBe(0)
    expect(g.canBeDone).toBe(true)
  })

  // The other direction of the same LUM-789 split: an explicit FAIL is a real
  // send-back, not a tacit pass, so it must still hold canBeDone false.
  it('human: an explicit FAIL still counts as pending', () => {
    const g = deriveRecordGaps({
      data: view({
        criteria: [
          crit('FAIL', { verifier: 'HUMAN' }),
          crit('PASS', { verifier: 'HUMAN' }),
        ],
      }),
      crossings: [],
      gateEnabled: true,
    })
    expect(g.humanTotal).toBe(2)
    expect(g.humanPending).toBe(1)
    expect(g.canBeDone).toBe(false)
  })

  it('human: all judged (PASS) -> zero pending', () => {
    const g = deriveRecordGaps({
      data: view({
        criteria: [
          crit('PASS', { verifier: 'HUMAN' }),
          crit('PASS', { verifier: 'HUMAN' }),
        ],
      }),
      crossings: [],
      gateEnabled: true,
    })
    expect(g.humanTotal).toBe(2)
    expect(g.humanPending).toBe(0)
    expect(g.canBeDone).toBe(true)
  })

  it('human: a DONE task forces pending to 0 even with an unjudged human criterion', () => {
    const g = deriveRecordGaps({
      data: view({
        task: { id: 't', identifier: 'LUM-1', title: 'x', status: 'DONE' },
        criteria: [crit(null, { verifier: 'HUMAN' })],
      }),
      crossings: [],
      gateEnabled: true,
    })
    expect(g.humanTotal).toBe(1)
    expect(g.humanPending).toBe(0)
    expect(g.canBeDone).toBe(true)
  })

  it('crossings: open, non-advisory, gate enabled -> blocks', () => {
    const g = deriveRecordGaps({
      data: view({ criteria: [] }),
      crossings: [crossing({ severity: 'LOW', advisory: false })],
      gateEnabled: true,
    })
    expect(g.crossingsOpen).toBe(1)
    expect(g.crossingsBlocking).toBe(1)
    expect(g.canBeDone).toBe(false)
  })

  it('crossings: advisory never blocks, even with the gate on and HIGH severity', () => {
    const g = deriveRecordGaps({
      data: view({ criteria: [] }),
      crossings: [crossing({ severity: 'HIGH', advisory: true })],
      gateEnabled: true,
    })
    expect(g.crossingsOpen).toBe(1)
    expect(g.crossingsBlocking).toBe(0)
    expect(g.canBeDone).toBe(true)
  })

  it('crossings: gate off + LOW severity -> open but not blocking', () => {
    const g = deriveRecordGaps({
      data: view({ criteria: [] }),
      crossings: [crossing({ severity: 'LOW', advisory: false })],
      gateEnabled: false,
    })
    expect(g.crossingsOpen).toBe(1)
    expect(g.crossingsBlocking).toBe(0)
    expect(g.canBeDone).toBe(true)
  })

  it('crossings: gate off but HIGH severity still blocks', () => {
    const g = deriveRecordGaps({
      data: view({ criteria: [] }),
      crossings: [crossing({ severity: 'HIGH', advisory: false })],
      gateEnabled: false,
    })
    expect(g.crossingsBlocking).toBe(1)
    expect(g.canBeDone).toBe(false)
  })

  it('crossings: a dispositioned crossing is neither open nor blocking', () => {
    const g = deriveRecordGaps({
      data: view({ criteria: [] }),
      crossings: [
        crossing({
          severity: 'HIGH',
          advisory: false,
          disposition: 'CONFIRMED',
        }),
      ],
      gateEnabled: true,
    })
    expect(g.crossingsOpen).toBe(0)
    expect(g.crossingsBlocking).toBe(0)
    expect(g.crossingsTotal).toBe(1)
    expect(g.canBeDone).toBe(true)
  })

  it('securityBlocking: defaults to 0 and does not affect other counts, but blocks canBeDone', () => {
    const g = deriveRecordGaps({
      data: view({ criteria: [crit('PASS')] }),
      crossings: [],
      gateEnabled: true,
      securityBlocking: 2,
    })
    expect(g.securityBlocking).toBe(2)
    expect(g.canBeDone).toBe(false)
  })

  it('securityBlocking: omitted defaults to 0', () => {
    const g = deriveRecordGaps({
      data: view({ criteria: [] }),
      crossings: [],
      gateEnabled: true,
    })
    expect(g.securityBlocking).toBe(0)
  })

  it('canBeDone is true only when every gate is clear at once', () => {
    const g = deriveRecordGaps({
      data: view({
        criteria: [crit('PASS'), crit('PASS', { verifier: 'HUMAN' })],
      }),
      crossings: [
        crossing({
          severity: 'HIGH',
          advisory: false,
          disposition: 'CONFIRMED',
        }),
      ],
      gateEnabled: true,
    })
    expect(g.canBeDone).toBe(true)
  })
})
