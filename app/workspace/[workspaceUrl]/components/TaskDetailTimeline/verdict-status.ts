import type {
  CriterionLatestVerdictView,
  TaskAcceptanceStatusView,
  TaskStatusCriterionView,
} from '../../types'
// LUM-789 whole-branch review (Finding 3): the hero ring/banner must count a
// tacit-pass HUMAN criterion (un-adjudicated, no verdict) as met — the same
// rule the NEEDS ACTION/record zone split and the CLI already use. Zero-
// import, so pulling it into this 'use client' module never drags Prisma in.
import { isUnmetForDisplay } from '@/lib/acceptance/unmet-display'

export function isPass(verdict: string | undefined): boolean {
  return verdict === 'PASS' || verdict === 'PASS_WITH_FOLLOWUP'
}

// LUM-611: the machine round that vouches for this criterion, for surfacing its
// evidence in the acceptance tab. A human PASS that overrode `latestVerdict`
// does NOT erase the checkpointer run below it — when a checkpointer currently
// vouches (machinePassed), its verdict (round + `cmd:` evidence) is what the tab
// should disclose, even though `latestVerdict` is now HUMAN with no pointer.
// Returns null for a genuine human override (machinePassed === false) and for
// HUMAN criteria — there is no machine evidence to show in those cases, so the
// tab correctly falls back to its override / pending copy.
export function machineEvidenceVerdict(
  c: Pick<TaskStatusCriterionView, 'machinePassed' | 'machineVerdict'>
): CriterionLatestVerdictView | null {
  return c.machinePassed ? (c.machineVerdict ?? null) : null
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
  // N-3 (whole-branch review, second pass): repurposed. Under the tacit-pass
  // `met` (Finding 3), the ORIGINAL "MACHINE done, HUMAN hasn't judged yet"
  // meaning became unreachable — `met === total` now fires whenever every
  // MACHINE criterion is verified and no HUMAN criterion holds an explicit
  // FAIL, which is exactly `machineAllPass`'s own precondition. Rather than
  // leave that dead slot as a tombstone (plus grow a 17th kind and a 17th
  // locale key), it now carries N-1's tacit-aware "met, but not every HUMAN
  // criterion carries an explicit verdict" state — neutral tone, honest
  // "accepted as drafted" copy, never the green allPassed check.
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
  /** N-1: how many HUMAN criteria carry an explicit verdict, out of how many
   *  exist — the ICU values for the (repurposed) `machineAwaitingHuman`
   *  kind's title, which must say "N/M judged, rest accepted as drafted"
   *  rather than a bare "criteria met" that hides whether anyone looked. */
  humanJudgedCount: number
  humanTotal: number
}

export function deriveVerdictStatus(
  data: TaskAcceptanceStatusView
): VerdictStatus {
  const total = data.criteria.length
  // Finding 3: `met` must count a tacit-pass HUMAN criterion (un-adjudicated,
  // no verdict) as met, not as outstanding — otherwise the hero ring/banner
  // ran a stricter, pre-LUM-789 rule than the record zone directly below it,
  // producing a "0/2 met · Acceptance in progress" banner sitting right above
  // the zone's own honest "0 pending · Accepted as drafted".
  const met = data.criteria.filter(
    c => !isUnmetForDisplay(c, c.latestVerdict ?? undefined)
  ).length
  const failCount = data.criteria.filter(
    c => c.latestVerdict?.verdict === 'FAIL'
  ).length
  const hasFail = failCount > 0
  const hasHumanOverride = data.criteria.some(isHumanOverride)
  const anyHumanVerdict = data.criteria.some(
    c => c.latestVerdict?.verifierType === 'HUMAN'
  )

  // N-1 (whole-branch review, second pass): F3 fixed `met`'s number but left
  // `kind`/`tone` running the pre-LUM-789 rule — "every criterion met" still
  // meant `allPassed` (green check, "All criteria met") even when every
  // HUMAN criterion in the contract was a tacit pass nobody looked at. That
  // relocated the false "adjudicated" claim from the count onto the icon and
  // title instead of removing it. Same judged/tacit/mixed split
  // AcceptanceTab.tsx's `humanAllExplicitlyJudged` already uses — vacuously
  // true when there are no HUMAN criteria at all (a MACHINE-only contract
  // has nothing to tacitly accept, so it stays a plain, honest `allPassed`).
  const humanCriteria = data.criteria.filter(c => c.verifierType === 'HUMAN')
  const humanJudgedCount = humanCriteria.filter(
    c => c.latestVerdict != null
  ).length
  const humanAllExplicitlyJudged = humanJudgedCount === humanCriteria.length

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
  } else if (met === total && total > 0 && humanAllExplicitlyJudged) {
    tone = 'success'
    kind = 'allPassed'
  } else if (met === total && total > 0) {
    // N-3: the repurposed `machineAwaitingHuman` slot — everything is met
    // (nothing blocks Done), but at least one HUMAN criterion settled as a
    // tacit pass rather than an actual verdict. Neutral, not success; the
    // title (VerdictDecision.tsx) renders `humanJudgedCount`/`humanTotal`
    // into honest "N/M judged, rest accepted as drafted" copy instead of a
    // bare "criteria met" that hides whether anyone actually looked.
    tone = 'neutral'
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
    humanJudgedCount,
    humanTotal: humanCriteria.length,
  }
}
