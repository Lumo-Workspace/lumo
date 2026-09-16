import {
  deriveVerdictStatus,
  machineEvidenceVerdict,
} from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/verdict-status'
import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
  CriterionSource,
  CriterionLatestVerdictView,
  AcceptanceVerdict,
} from '@/app/workspace/[workspaceUrl]/types'

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

const crit = (
  v: AcceptanceVerdict | null,
  verifier: 'MACHINE' | 'HUMAN' = 'MACHINE'
): TaskStatusCriterionView => ({
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
  machinePassed: v === 'PASS' && verifier === 'MACHINE',
  verdictStale: false,
  checkMismatch: false,
  changeState: null,
  changedAtRound: null,
  lastEdit: null,
  confirmedAt: null,
})

describe('deriveVerdictStatus', () => {
  it('all criteria PASS -> success/allPassed with met=total', () => {
    const s = deriveVerdictStatus(
      view({ criteria: [crit('PASS'), crit('PASS')] })
    )
    expect(s.tone).toBe('success')
    expect(s.kind).toBe('allPassed')
    expect(s.met).toBe(2)
    expect(s.total).toBe(2)
    expect(s.gateBlocked).toBe(false)
  })
  it('a FAIL -> danger/sentBack and gateBlocked', () => {
    const s = deriveVerdictStatus(
      view({ criteria: [crit('PASS'), crit('FAIL')] })
    )
    expect(s.tone).toBe('danger')
    expect(s.kind).toBe('sentBack')
    expect(s.failCount).toBe(1)
    expect(s.gateBlocked).toBe(true)
  })
  it('escalated wins over everything', () => {
    const s = deriveVerdictStatus(
      view({ escalated: true, criteria: [crit('FAIL')] })
    )
    expect(s.kind).toBe('escalated')
    expect(s.tone).toBe('danger')
  })
  it('round + max passed through', () => {
    const s = deriveVerdictStatus(
      view({ currentRound: 3, maxRounds: 5, criteria: [crit('PASS')] })
    )
    expect(s.round).toBe(3)
    expect(s.maxRounds).toBe(5)
  })
  // Finding 3 (whole-branch review): this scenario used to assert
  // `machineAwaitingHuman` because `met` only counted an explicit PASS — a
  // HUMAN criterion nobody ever adjudicated made `met !== total` forever.
  // That's the exact bug the finding names: the banner would show "1/2 met ·
  // awaiting human verdict" directly above the record zone's already-correct
  // "0 pending · Accepted as drafted". A tacit-pass HUMAN criterion is now
  // met, so this reaches allPassed instead — see the companion test below for
  // the direction that still needs an actual `machineAwaitingHuman`-shaped
  // gap (there isn't a reachable one; see the code comment at its call site).
  it('an un-adjudicated HUMAN criterion is a tacit pass: all-MACHINE-verified + no HUMAN verdict -> allPassed, met=total', () => {
    const s = deriveVerdictStatus(
      view({ criteria: [crit('PASS', 'MACHINE'), crit(null, 'HUMAN')] })
    )
    expect(s.kind).toBe('allPassed')
    expect(s.tone).toBe('success')
    expect(s.met).toBe(2)
    expect(s.total).toBe(2)
  })

  // Falsifies the other direction: a genuinely unverified MACHINE criterion
  // must still NOT count as met, tacit-pass or not — only HUMAN criteria get
  // the tacit-pass exemption (isUnmetForDisplay never extends it to MACHINE).
  it('an unverified MACHINE criterion still keeps met below total, even alongside a tacit HUMAN pass', () => {
    const s = deriveVerdictStatus(
      view({ criteria: [crit(null, 'MACHINE'), crit(null, 'HUMAN')] })
    )
    expect(s.met).toBe(1)
    expect(s.total).toBe(2)
    expect(s.kind).not.toBe('allPassed')
  })
  it('DONE task: doneNoHumanVerdict when no criterion has a HUMAN verdict, done when one does', () => {
    const noHuman = deriveVerdictStatus(
      view({
        task: { id: 't', identifier: 'LUM-1', title: 'x', status: 'DONE' },
        criteria: [crit('PASS', 'MACHINE')],
      })
    )
    expect(noHuman.kind).toBe('doneNoHumanVerdict')

    const withHuman = deriveVerdictStatus(
      view({
        task: { id: 't', identifier: 'LUM-1', title: 'x', status: 'DONE' },
        criteria: [crit('PASS', 'MACHINE'), crit('PASS', 'HUMAN')],
      })
    )
    expect(withHuman.kind).toBe('done')
  })
})

describe('machineEvidenceVerdict LUM-611', () => {
  const machineRound: CriterionLatestVerdictView = {
    round: 2,
    verdict: 'PASS',
    verifierType: 'MACHINE',
    evidencePointer: 'cmd:npx jest target.test.ts#exit=0',
    rejectionReason: null,
    rejectionReasonEnum: null,
    recordedAt: 'now',
  }

  it('machineEvidenceVerdict returns the machine round for a machine pass and null for a human override LUM611', () => {
    // A checkpointer-verified criterion whose latest verdict is a human PASS
    // sign-off (no evidence) — the machine round below it is the evidence.
    const overridden: TaskStatusCriterionView = {
      ...crit('PASS', 'MACHINE'),
      machinePassed: true,
      machineVerdict: machineRound,
      latestVerdict: {
        round: 3,
        verdict: 'PASS',
        verifierType: 'HUMAN',
        evidencePointer: null,
        rejectionReason: null,
        rejectionReasonEnum: null,
        recordedAt: 'now',
      },
    }
    expect(machineEvidenceVerdict(overridden)).toEqual(machineRound)

    // A genuine human override (no checkpointer ever vouched) → no machine
    // evidence to surface.
    const genuineOverride: TaskStatusCriterionView = {
      ...crit('PASS', 'MACHINE'),
      machinePassed: false,
      machineVerdict: null,
    }
    expect(machineEvidenceVerdict(genuineOverride)).toBeNull()
  })

  it('returns null when machinePassed is true but no machineVerdict is present LUM611', () => {
    const c: TaskStatusCriterionView = {
      ...crit('PASS', 'MACHINE'),
      machinePassed: true,
      machineVerdict: null,
    }
    expect(machineEvidenceVerdict(c)).toBeNull()
  })
})
