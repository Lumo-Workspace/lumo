import type { BoundaryCrossingView } from '../../hooks/useBoundaryCrossings'

/**
 * The Done-gap counts (LUM-496): what still blocks the task from reaching
 * DONE, derived from the crossings list + the security-scan blocking count.
 * Pure — no intl, no fetching — so `RecordStatusStrip` and the NEEDS ACTION
 * zone share one source of truth for "is there anything left?".
 */
export interface RecordGaps {
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
  /** LUM-1011: test-case runs proven to be implementation defects and not yet
   *  ruled on (latest run per case — the LUM-812 DONE gate). 0 when the caller
   *  has no test-case signal. */
  testsBlocking: number
  /** No blocking item remains anywhere — advisory crossings and non-blocking
   *  open crossings do not count. */
  canBeDone: boolean
  /** The task is already DONE. Carried on the gaps so the strip can say
   *  "Accepted" instead of "the task can be marked Done" (LUM-496 review F3). */
  taskDone: boolean
}

export function deriveRecordGaps(input: {
  taskStatus: string
  crossings: BoundaryCrossingView[]
  gateEnabled: boolean
  securityBlocking?: number
  testsBlocking?: number
}): RecordGaps {
  const {
    taskStatus,
    crossings,
    gateEnabled,
    securityBlocking = 0,
    testsBlocking = 0,
  } = input

  const openCrossings = crossings.filter(c => c.disposition == null)
  // Mirrors BoundaryCrossingsPanel's blockingCount (LUM-590/LUM-442): advisory
  // crossings never block; with the workspace gate opted out, only HIGH does.
  const crossingsBlocking = openCrossings.filter(
    c => !c.advisory && (gateEnabled || c.severity === 'HIGH')
  ).length

  return {
    crossingsOpen: openCrossings.length,
    crossingsBlocking,
    crossingsTotal: crossings.length,
    securityBlocking,
    testsBlocking,
    canBeDone:
      crossingsBlocking === 0 && securityBlocking === 0 && testsBlocking === 0,
    taskDone: taskStatus === 'DONE',
  }
}
