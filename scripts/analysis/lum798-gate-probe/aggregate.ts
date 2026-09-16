/**
 * LUM-798 — the read-out behind this task's one HUMAN criterion: over the
 * scans whose hunt layer actually ran, what fraction of candidates the
 * mechanical gate REJECTED, and whether the falsifier ever got to speak.
 *
 * Pure, so it is testable without a database. It exists because the LUM-739
 * audit script cannot answer either question: it buckets rejections by the
 * text before the first `:`, so all 28 production rejections collapsed into
 * one row reading `symbol-not-in-subgraph 28` and the symbol — the thing the
 * argument is about — was never printed at all.
 */

/** One scan's `huntAudit`, as loose as the Json column really is. */
export interface HuntAuditRow {
  headSha: string
  prNumber: number | null
  startedAt: Date
  huntStage: string | null
  audit: Record<string, unknown> | null
}

export interface GateReadout {
  scansWithHunt: number
  scansWithGateResult: number
  /** Scans whose audit carries the LUM-798 tally — i.e. ran the new gate. */
  scansWithResolution: number
  candidates: number
  resolution: { subgraph: number; sinkRule: number; sandbox: number }
  rejected: number
  /** null when no candidate was submitted at all — never a fabricated 0%. */
  rejectionRate: number | null
  falsifierVerdicts: number
  /** Full reason strings, most frequent first — symbol included. */
  reasons: Array<{ reason: string; count: number }>
}

function int(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export function readGateResults(rows: HuntAuditRow[]): GateReadout {
  const out: GateReadout = {
    scansWithHunt: 0,
    scansWithGateResult: 0,
    scansWithResolution: 0,
    candidates: 0,
    resolution: { subgraph: 0, sinkRule: 0, sandbox: 0 },
    rejected: 0,
    rejectionRate: null,
    falsifierVerdicts: 0,
    reasons: [],
  }
  const byReason = new Map<string, number>()
  for (const row of rows) {
    const a = row.audit
    if (row.huntStage === null && a === null) continue
    out.scansWithHunt += 1
    if (a === null) continue
    const rejected = Array.isArray(a.rejected) ? a.rejected : []
    const candidates = int(a.candidates)
    if (candidates === 0 && rejected.length === 0) continue
    out.scansWithGateResult += 1
    out.candidates += candidates
    out.rejected += rejected.length
    for (const r of rejected as Record<string, unknown>[]) {
      const reason = typeof r.reason === 'string' ? r.reason : '(none)'
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1)
    }
    const res = a.resolution
    if (res && typeof res === 'object') {
      out.scansWithResolution += 1
      const r = res as Record<string, unknown>
      out.resolution.subgraph += int(r.subgraph)
      out.resolution.sinkRule += int(r.sinkRule)
      out.resolution.sandbox += int(r.sandbox)
    }
    // A falsifier verdict is a REJECT counted in the audit, or an
    // INCONCLUSIVE that became a finding — both are "the gate let something
    // through and the falsifier answered", which is what is being measured.
    out.falsifierVerdicts += int(a.falsifierRejects)
  }
  if (out.candidates > 0) out.rejectionRate = out.rejected / out.candidates
  out.reasons = [...byReason]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
  return out
}

export function formatGateReadout(r: GateReadout): string[] {
  const placed =
    r.resolution.subgraph + r.resolution.sinkRule + r.resolution.sandbox
  return [
    `scans with a hunt layer:      ${r.scansWithHunt}`,
    `  …that produced candidates:  ${r.scansWithGateResult}`,
    `  …that ran the LUM-798 gate: ${r.scansWithResolution}`,
    `candidates:                   ${r.candidates}`,
    `  placed by subgraph:         ${r.resolution.subgraph}`,
    `  placed by sink rule:        ${r.resolution.sinkRule}`,
    `  placed by sandbox sighting: ${r.resolution.sandbox}`,
    `  rejected:                   ${r.rejected}`,
    `rejection rate:               ${r.rejectionRate === null ? 'n/a (no candidate submitted)' : `${(r.rejectionRate * 100).toFixed(1)}%`}`,
    `accepted into the falsifier:  ${placed}`,
    `falsifier verdicts on record: ${r.falsifierVerdicts}`,
    '',
    'rejections by FULL reason (the symbol is the point):',
    ...r.reasons.map(x => `  ${String(x.count).padStart(3)}  ${x.reason}`),
  ]
}
