import type { RecordGaps } from './record-gaps'

/**
 * LUM-1009 — the Record tab's Done gate: one headline plus one row per gate
 * (boundary crossings, security scan, test cases), derived from `RecordGaps`. Pure — no
 * intl, no fetching — so `RecordDoneGate` only renders what this returns.
 */
export type DoneGateHeadline = 'accepted' | 'blocked' | 'ready'

export interface CrossingsGateRow {
  /** blocked: a blocking crossing is open · advisory: only non-blocking ones
   *  are open · clear: every crossing dispositioned · none: none recorded. */
  state: 'blocked' | 'advisory' | 'clear' | 'none'
  blocking: number
  /** Open crossings that need a disposition but do not block Done. */
  advisory: number
  dispositioned: number
  total: number
}

export interface SecurityGateRow {
  /** notScanned: the task has no scanned PR — never reported as clean. */
  state: 'blocked' | 'clear' | 'notScanned'
  blocking: number
}

export interface TestsGateRow {
  /** blocked: a proven defect awaits a ruling · clear: none · none: the task
   *  has no test cases (never reported as passing). */
  state: 'blocked' | 'clear' | 'none'
  blocking: number
  passing: number
  total: number
}

export interface DoneGate {
  headline: DoneGateHeadline
  /** Items that hold Done back: blocking crossings + blocking findings +
   *  undispositioned proven test defects. */
  blockingTotal: number
  crossings: CrossingsGateRow
  /** null when no plugin contributes a security check (LUM-1062). */
  security: SecurityGateRow | null
  tests: TestsGateRow
}

export function deriveDoneGate(
  gaps: RecordGaps,
  opts: {
    securityScanned: boolean
    /** LUM-1062: false without a plugin — no security row at all. */
    showSecurity?: boolean
    /** LUM-1011: test-case counts for the gate row's detail. */
    tests?: { total: number; passing: number }
  }
): DoneGate {
  const advisory = gaps.crossingsOpen - gaps.crossingsBlocking
  const crossingsState: CrossingsGateRow['state'] =
    gaps.crossingsTotal === 0
      ? 'none'
      : gaps.crossingsBlocking > 0
        ? 'blocked'
        : advisory > 0
          ? 'advisory'
          : 'clear'

  const securityState: SecurityGateRow['state'] =
    gaps.securityBlocking > 0
      ? 'blocked'
      : opts.securityScanned
        ? 'clear'
        : 'notScanned'

  const testsTotal = opts.tests?.total ?? 0
  const testsState: TestsGateRow['state'] =
    gaps.testsBlocking > 0 ? 'blocked' : testsTotal > 0 ? 'clear' : 'none'

  const blockingTotal =
    gaps.crossingsBlocking + gaps.securityBlocking + gaps.testsBlocking

  return {
    headline: gaps.taskDone
      ? 'accepted'
      : blockingTotal > 0
        ? 'blocked'
        : 'ready',
    blockingTotal,
    crossings: {
      state: crossingsState,
      blocking: gaps.crossingsBlocking,
      advisory,
      dispositioned: gaps.crossingsTotal - gaps.crossingsOpen,
      total: gaps.crossingsTotal,
    },
    security:
      opts.showSecurity === false
        ? null
        : { state: securityState, blocking: gaps.securityBlocking },
    tests: {
      state: testsState,
      blocking: gaps.testsBlocking,
      passing: opts.tests?.passing ?? 0,
      total: testsTotal,
    },
  }
}
