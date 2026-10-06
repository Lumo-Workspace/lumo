import type { RecordGaps } from './record-gaps'

/**
 * LUM-1009 — the Record tab's Done gate: one headline plus one row per gate
 * (boundary crossings, security scan), derived from `RecordGaps`. Pure — no
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

export interface DoneGate {
  headline: DoneGateHeadline
  /** Items that hold Done back: blocking crossings + blocking findings. */
  blockingTotal: number
  crossings: CrossingsGateRow
  security: SecurityGateRow
}

export function deriveDoneGate(
  gaps: RecordGaps,
  opts: { securityScanned: boolean }
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

  const blockingTotal = gaps.crossingsBlocking + gaps.securityBlocking

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
    security: { state: securityState, blocking: gaps.securityBlocking },
  }
}
