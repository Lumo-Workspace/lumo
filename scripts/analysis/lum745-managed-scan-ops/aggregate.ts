/**
 * LUM-745 — pure aggregation for the managed-scan ops read-out (milestone
 * exit criterion: last 20 managed scans ≥ 90% external RAN, no PENDING older
 * than 45 min, superseded runs cancelled). `report.ts` reads the rows; this
 * file only counts.
 */
import { EXTERNAL_ERROR_PREFIX } from '@/ee/security/security-scan/stages'
import { EXTERNAL_PENDING_DEAD_MS } from '@/ee/security/services/security-managed-scan.config'

export interface ManagedScanRow {
  id: string
  stages: unknown
  error: string | null
  startedAt: Date
  managedRunId: string | null
}

export interface ManagedScanOpsStats {
  scans: number
  external: {
    RAN: number
    FAILED: number
    PENDING: number
    SUPERSEDED: number
    /** Any other state, or no external key at all. */
    other: number
  }
  /** RAN / (scans − SUPERSEDED); null when nothing is left in the denominator. */
  ranRate: number | null
  /** PENDING rows older than `EXTERNAL_PENDING_DEAD_MS` — the sweep's backlog. */
  pendingOver45Min: number
  /** FAILED rows by `failureKey(error)`. */
  failureReasons: Record<string, number>
}

type CountedState = 'RAN' | 'FAILED' | 'PENDING' | 'SUPERSEDED'
const COUNTED: CountedState[] = ['RAN', 'FAILED', 'PENDING', 'SUPERSEDED']

function externalStateOf(stages: unknown): string | null {
  const state = (stages as { external?: unknown } | null)?.external
  return typeof state === 'string' ? state : null
}

/**
 * The reason's head: the text after `external: ` up to the first ':' or ';',
 * capped at 60 chars. Unprefixed / missing errors (stage A's own crash text)
 * are `unknown` — they are not the external scanner's reason (P8).
 */
export function failureKey(error: string | null): string {
  if (!error || !error.startsWith(EXTERNAL_ERROR_PREFIX)) return 'unknown'
  const body = error.slice(EXTERNAL_ERROR_PREFIX.length)
  const cut = body.search(/[:;]/)
  const head = (cut === -1 ? body : body.slice(0, cut)).trim().slice(0, 60)
  return head.length > 0 ? head : 'unknown'
}

export function aggregateManagedScanOps(
  rows: ManagedScanRow[],
  now: Date
): ManagedScanOpsStats {
  const stats: ManagedScanOpsStats = {
    scans: rows.length,
    external: { RAN: 0, FAILED: 0, PENDING: 0, SUPERSEDED: 0, other: 0 },
    ranRate: null,
    pendingOver45Min: 0,
    failureReasons: {},
  }
  for (const row of rows) {
    const state = externalStateOf(row.stages)
    if (state && (COUNTED as string[]).includes(state)) {
      stats.external[state as CountedState] += 1
    } else {
      stats.external.other += 1
    }
    if (
      state === 'PENDING' &&
      now.getTime() - row.startedAt.getTime() > EXTERNAL_PENDING_DEAD_MS
    ) {
      stats.pendingOver45Min += 1
    }
    if (state === 'FAILED') {
      const key = failureKey(row.error)
      stats.failureReasons[key] = (stats.failureReasons[key] ?? 0) + 1
    }
  }
  const denominator = stats.scans - stats.external.SUPERSEDED
  stats.ranRate = denominator > 0 ? stats.external.RAN / denominator : null
  return stats
}
