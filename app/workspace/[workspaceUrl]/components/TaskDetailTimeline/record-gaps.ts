import type { TaskAcceptanceStatusView } from '../../types'
import type { BoundaryCrossingView } from '../../hooks/useBoundaryCrossings'
import { isPass, machineRollup } from './verdict-status'

/**
 * The Done-gap counts (LUM-496): what still blocks the task from reaching
 * DONE, derived from the acceptance status view + the crossings list. Pure —
 * no intl, no fetching — so `RecordStatusStrip` and the NEEDS ACTION zone
 * (Task 5) can share one source of truth for "is there anything left?".
 */
export interface RecordGaps {
  /** MACHINE criteria not yet verified by a checkpointer (failed, unjudged, or
   *  currently passing only via a human override — honest per `machineRollup`);
   *  forced to 0 once the task is DONE, mirroring `humanPending`: a closed task
   *  has nothing left to act on, so it must not read as NEEDS ACTION. The
   *  `machineVerified` / `machineTotal` pair below stays honest either way. */
  machineAwaiting: number
  /** Every MACHINE criterion, and the subset a checkpointer actually passed —
   *  reported as measured even on a DONE task (the Machine-verified record
   *  card renders `verified/total` plus its override/failed caption from them). */
  machineTotal: number
  machineVerified: number
  /** HUMAN criteria without a live PASS; forced to 0 once the task is DONE —
   *  there is nothing left to judge on a closed task. */
  humanPending: number
  humanTotal: number
  /** Crossings with no disposition yet (`disposition == null`), regardless of
   *  whether they block Done. */
  crossingsOpen: number
  /** The subset of `crossingsOpen` that actually blocks Done: not advisory,
   *  and either the workspace gate is on or the crossing is HIGH severity
   *  (mirrors `BoundaryCrossingsPanel`'s `blockingCount`, LUM-590/LUM-442). */
  crossingsBlocking: number
  crossingsTotal: number
  /** Undispositioned security findings that block DONE, when known; 0 when
   *  the caller has no security signal to report (never fabricated). */
  securityBlocking: number
  /** No blocking item remains anywhere — advisory crossings and non-blocking
   *  open crossings do not count. */
  canBeDone: boolean
  /** The task is already DONE (`data.task.status`). Carried on the gaps so the
   *  strip can say "Accepted" instead of "the task can be marked Done" without
   *  a second prop threaded through every caller (LUM-496 review F3) — the
   *  same flag that zeroes `machineAwaiting` / `humanPending` above. */
  taskDone: boolean
}

export function deriveRecordGaps(input: {
  data: TaskAcceptanceStatusView
  crossings: BoundaryCrossingView[]
  gateEnabled: boolean
  securityBlocking?: number
}): RecordGaps {
  const { data, crossings, gateEnabled, securityBlocking = 0 } = input

  const taskDone = data.task.status === 'DONE'

  const machine = machineRollup(data.criteria)
  // Same DONE rule as `humanPending`: a closed task owes the reviewer no
  // action, so an unverified (or human-carried) check is a record, not a gap.
  // The verified/total pair stays measured — the record card still tells the
  // honest story of what a checkpointer actually passed.
  const machineAwaiting = taskDone ? 0 : machine.total - machine.verified

  const humanCriteria = data.criteria.filter(c => c.verifierType === 'HUMAN')
  const humanTotal = humanCriteria.length
  const humanPending = taskDone
    ? 0
    : humanCriteria.filter(c => !isPass(c.latestVerdict?.verdict)).length

  const openCrossings = crossings.filter(c => c.disposition == null)
  const crossingsOpen = openCrossings.length
  const crossingsTotal = crossings.length
  // Mirrors BoundaryCrossingsPanel's blockingCount (LUM-590/LUM-442): advisory
  // crossings never block; with the workspace gate opted out, only HIGH does.
  const crossingsBlocking = openCrossings.filter(
    c => !c.advisory && (gateEnabled || c.severity === 'HIGH')
  ).length

  const canBeDone =
    machineAwaiting === 0 &&
    humanPending === 0 &&
    crossingsBlocking === 0 &&
    securityBlocking === 0

  return {
    machineAwaiting,
    machineTotal: machine.total,
    machineVerified: machine.verified,
    humanPending,
    humanTotal,
    crossingsOpen,
    crossingsBlocking,
    crossingsTotal,
    securityBlocking,
    canBeDone,
    taskDone,
  }
}
