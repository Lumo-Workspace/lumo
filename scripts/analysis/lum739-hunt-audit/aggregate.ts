/**
 * LUM-739 — pure aggregation for the hunt audit (spec §6 L3 "Verify" step
 * 4 / §12 R2): the falsifier REJECT rate and the INCONCLUSIVE → FALSE_POSITIVE
 * disposition rate are the data the "may LLM_JUDGE ever block DONE" decision
 * waits on. `audit.ts` reads the rows; this file only counts.
 */

export interface HuntScanRow {
  id: string
  stages: unknown
  huntAudit: unknown
  tokenSpent: number | null
  findings: Array<{
    ruleId: string
    provenance: string
    disposition: string | null
    falsifierVerdict: string | null
  }>
}

export interface HuntAuditStats {
  scans: number
  hunt: {
    RAN: number
    PARTIAL: number
    FAILED: number
    PENDING: number
    SKIPPED: number
  }
  candidates: number
  mechanicalRejected: number
  /** Keyed by the reason's prefix before the first ':' (e.g. `edge-not-in-subgraph`). */
  rejectReasons: Record<string, number>
  falsifierRejects: number
  /** Persisted hunt findings (every persisted row is falsifier-INCONCLUSIVE). */
  inconclusive: number
  /** falsifierRejects / (falsifierRejects + inconclusive); null when nothing was judged. */
  falsifierRejectRate: number | null
  falsePositive: number
  acceptedRisk: number
  /** falsePositive / inconclusive; null when no finding was persisted. */
  inconclusiveToFalsePositiveRate: number | null
  tokenSpent: { measured: number; total: number }
}

type HuntState = keyof HuntAuditStats['hunt']
const HUNT_STATES: HuntState[] = [
  'RAN',
  'PARTIAL',
  'FAILED',
  'PENDING',
  'SKIPPED',
]

function huntStateOf(stages: unknown): HuntState | null {
  const state = (stages as { hunt?: unknown } | null)?.hunt
  return typeof state === 'string' && (HUNT_STATES as string[]).includes(state)
    ? (state as HuntState)
    : null
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function reasonKey(reason: unknown): string {
  if (typeof reason !== 'string' || reason.length === 0) return 'unknown'
  const i = reason.indexOf(':')
  return i === -1 ? reason : reason.slice(0, i)
}

export function aggregateHuntAudit(rows: HuntScanRow[]): HuntAuditStats {
  const stats: HuntAuditStats = {
    scans: rows.length,
    hunt: { RAN: 0, PARTIAL: 0, FAILED: 0, PENDING: 0, SKIPPED: 0 },
    candidates: 0,
    mechanicalRejected: 0,
    rejectReasons: {},
    falsifierRejects: 0,
    inconclusive: 0,
    falsifierRejectRate: null,
    falsePositive: 0,
    acceptedRisk: 0,
    inconclusiveToFalsePositiveRate: null,
    tokenSpent: { measured: 0, total: 0 },
  }
  for (const row of rows) {
    const state = huntStateOf(row.stages)
    if (state) stats.hunt[state] += 1
    const audit = (row.huntAudit ?? {}) as Record<string, unknown>
    stats.candidates += num(audit.candidates)
    stats.falsifierRejects += num(audit.falsifierRejects)
    const rejected = Array.isArray(audit.rejected) ? audit.rejected : []
    stats.mechanicalRejected += rejected.length
    for (const r of rejected) {
      const key = reasonKey((r as { reason?: unknown } | null)?.reason)
      stats.rejectReasons[key] = (stats.rejectReasons[key] ?? 0) + 1
    }
    if (row.tokenSpent !== null) {
      stats.tokenSpent.measured += 1
      stats.tokenSpent.total += row.tokenSpent
    }
    for (const f of row.findings) {
      if (!f.ruleId.startsWith('hunt:')) continue
      stats.inconclusive += 1
      if (f.disposition === 'FALSE_POSITIVE') stats.falsePositive += 1
      else if (f.disposition === 'ACCEPTED_RISK') stats.acceptedRisk += 1
    }
  }
  const judged = stats.falsifierRejects + stats.inconclusive
  stats.falsifierRejectRate =
    judged > 0 ? stats.falsifierRejects / judged : null
  stats.inconclusiveToFalsePositiveRate =
    stats.inconclusive > 0 ? stats.falsePositive / stats.inconclusive : null
  return stats
}
