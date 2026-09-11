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
  /**
   * LUM-758 — the fields three deferred launch decisions depend on. They were
   * persisted from the start and read by nothing, so "watch it in the first
   * week's data" had no way to happen: diagnosing why one task went blind meant
   * dividing 133 by 7 by hand.
   */
  plan: {
    /** How the plan was produced. `notAttempted` = a short circuit ran first. */
    by: {
      model: number
      fallback: number
      notAttempted: number
      unknown: number
    }
    /** Distribution of planned-task counts — `0` is the SKIPPED path. */
    taskCounts: Record<string, number>
  }
  /** Why each planned task stopped: done / steps / budget / timeout / error / skipped. */
  taskStops: Record<string, number>
  /**
   * LUM-758 follow-up — tasks that never called `submit_candidates` on their
   * own and were asked by the forced wrap-up. Read against `taskStops.done`:
   * a layer where every task is wrapped up is a layer whose agent never
   * decides, and no amount of budget or context has changed that yet.
   */
  tasksWrappedUp: number
  sandbox: { attached: number; created: number; egressOpen: number }
  compress: {
    scans: number
    calls: number
    /** Charged calls that produced nothing usable — the blind-agent signal. */
    noOpCalls: number
    inputChars: number
    outputChars: number
    tokens: number
  }
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
    plan: {
      by: { model: 0, fallback: 0, notAttempted: 0, unknown: 0 },
      taskCounts: {},
    },
    taskStops: {},
    tasksWrappedUp: 0,
    sandbox: { attached: 0, created: 0, egressOpen: 0 },
    compress: {
      scans: 0,
      calls: 0,
      noOpCalls: 0,
      inputChars: 0,
      outputChars: 0,
      tokens: 0,
    },
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

    // LUM-758. Every field below is optional by construction: rows written
    // before the task graph carry none of them, and must not be counted as a
    // zero — a pre-758 scan did not plan zero tasks, it did not plan at all.
    const by = audit.plannedBy
    if (by === 'model' || by === 'fallback') stats.plan.by[by] += 1
    else if (by === 'not-attempted') stats.plan.by.notAttempted += 1
    else if (by !== undefined) stats.plan.by.unknown += 1
    if (Array.isArray(audit.planned)) {
      const n = String(audit.planned.length)
      stats.plan.taskCounts[n] = (stats.plan.taskCounts[n] ?? 0) + 1
    }

    const tasks = Array.isArray(audit.tasks) ? audit.tasks : []
    for (const t of tasks) {
      const stop = (t as { stopped?: unknown } | null)?.stopped
      const key = typeof stop === 'string' ? stop : 'unknown'
      stats.taskStops[key] = (stats.taskStops[key] ?? 0) + 1
      if ((t as { wrappedUp?: unknown } | null)?.wrappedUp === true)
        stats.tasksWrappedUp += 1
    }

    if (audit.sandbox === 'attached') stats.sandbox.attached += 1
    if (audit.sandbox === 'created') stats.sandbox.created += 1
    // `false` is the meaningful value: the run executed with a route out.
    if (audit.egressDenied === false) stats.sandbox.egressOpen += 1

    const c = audit.compress
    if (c && typeof c === 'object') {
      const cc = c as Record<string, unknown>
      stats.compress.scans += 1
      stats.compress.calls += num(cc.calls)
      stats.compress.noOpCalls += num(cc.noOpCalls)
      stats.compress.inputChars += num(cc.inputChars)
      stats.compress.outputChars += num(cc.outputChars)
      stats.compress.tokens += num(cc.tokens)
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
