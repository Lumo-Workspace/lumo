import type {
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
} from '../../types'

export function isPass(verdict: string | undefined): boolean {
  return verdict === 'PASS' || verdict === 'PASS_WITH_FOLLOWUP'
}

// A human override (LUM-456) = a MACHINE criterion that is currently passing
// without a checkpointer pass behind it (machinePassed === false). That is the
// only honest "machine PASS no checkpointer produced": a human is carrying it on
// their own authority. A normally human-judged criterion is not an override, and
// a redundant human sign-off on a genuine machine PASS is not one either.
export function isHumanOverride(c: TaskStatusCriterionView): boolean {
  return (
    c.verifierType === 'MACHINE' &&
    isPass(c.latestVerdict?.verdict) &&
    !c.machinePassed
  )
}

// LUM-456: honest split of the MACHINE criteria — verified (a checkpointer
// passed it) vs override (currently passing only by a human) vs failing/unjudged.
// Derived from the per-criterion machinePassed flag so the zone summary and the
// banner agree with the rows, and so "machine-verified" never counts an override.
export function machineRollup(criteria: TaskStatusCriterionView[]): {
  total: number
  verified: number
  overridden: number
  failed: number
} {
  const machine = criteria.filter(c => c.verifierType === 'MACHINE')
  const verified = machine.filter(
    c => c.machinePassed && isPass(c.latestVerdict?.verdict)
  ).length
  const overridden = machine.filter(isHumanOverride).length
  return {
    total: machine.length,
    verified,
    overridden,
    failed: machine.length - verified - overridden,
  }
}

export type VerdictTone = 'success' | 'danger' | 'neutral'
export type VerdictStatusKind =
  | 'escalated'
  | 'sentBack'
  | 'done'
  | 'doneNoHumanVerdict'
  | 'allPassed'
  | 'machineAwaitingHuman'
  | 'inProgress'

export interface VerdictStatus {
  tone: VerdictTone
  kind: VerdictStatusKind
  met: number
  total: number
  failCount: number
  hasHumanOverride: boolean
  gateBlocked: boolean
  round: number
  maxRounds: number
}

export function deriveVerdictStatus(
  data: TaskAcceptanceStatusView
): VerdictStatus {
  const total = data.criteria.length
  const met = data.criteria.filter(c => isPass(c.latestVerdict?.verdict)).length
  const failCount = data.criteria.filter(
    c => c.latestVerdict?.verdict === 'FAIL'
  ).length
  const hasFail = failCount > 0
  const hasHumanOverride = data.criteria.some(isHumanOverride)
  const anyHumanVerdict = data.criteria.some(
    c => c.latestVerdict?.verifierType === 'HUMAN'
  )
  // "Machine acceptance passed" must mean a checkpointer actually passed every
  // MACHINE criterion (LUM-456) — a human override does not count, or the banner
  // would impersonate machine verification.
  const machineStats = machineRollup(data.criteria)
  const machineAllPass =
    machineStats.total > 0 && machineStats.verified === machineStats.total

  let tone: VerdictTone = 'neutral'
  let kind: VerdictStatusKind = 'inProgress'

  if (data.escalated) {
    tone = 'danger'
    kind = 'escalated'
  } else if (hasFail) {
    tone = 'danger'
    kind = 'sentBack'
  } else if (data.task.status === 'DONE') {
    tone = 'success'
    kind = anyHumanVerdict ? 'done' : 'doneNoHumanVerdict'
  } else if (met === total && total > 0) {
    tone = 'success'
    kind = 'allPassed'
  } else if (machineAllPass) {
    tone = 'success'
    kind = 'machineAwaitingHuman'
  }

  return {
    tone,
    kind,
    met,
    total,
    failCount,
    hasHumanOverride,
    gateBlocked: hasFail,
    round: data.currentRound,
    maxRounds: data.maxRounds,
  }
}
