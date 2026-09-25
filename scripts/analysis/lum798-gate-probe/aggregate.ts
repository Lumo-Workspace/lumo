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
  /**
   * Of those, the ones carrying the FIRST tally shape, whose tier counts only
   * include candidates that survived to acceptance. Reported apart from
   * `placed` on purpose: adding the two would understate placement and
   * restate the very error the follow-up fixed.
   */
  scansWithLegacyTally: number
  candidates: number
  /** Sinks placed, counted AT placement — two-axis rows only. */
  placed: { subgraph: number; sinkRule: number; sandbox: number }
  /** Placement failed, or the submission never parsed — same rows. */
  unplaced: number
  /** Placed AND survived every later check — same rows. */
  accepted: number
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
    scansWithLegacyTally: 0,
    candidates: 0,
    placed: { subgraph: 0, sinkRule: 0, sandbox: 0 },
    unplaced: 0,
    accepted: 0,
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
    // "Did the new gate RUN" is asked first and unconditionally. A scan whose
    // hunt submitted nothing still ran it, and folding that case in with
    // "no tally on the row" would reproduce, in the read-out, the exact
    // zero-versus-never confusion this task exists to remove.
    const res = a.resolution
    if (res && typeof res === 'object') {
      out.scansWithResolution += 1
      const r = res as Record<string, unknown>
      const pl = r.placed
      if (pl && typeof pl === 'object') {
        const t = pl as Record<string, unknown>
        out.placed.subgraph += int(t.subgraph)
        out.placed.sinkRule += int(t.sinkRule)
        out.placed.sandbox += int(t.sandbox)
        out.unplaced += int(r.unplaced)
        out.accepted += int(r.accepted)
      } else {
        // The flat first shape. Its tier counts mean something else, so they
        // are NOT folded into `placed`; only the row is counted, so a reader
        // can see how much of the sample predates the fix.
        out.scansWithLegacyTally += 1
      }
    }
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
  const placedTotal = r.placed.subgraph + r.placed.sinkRule + r.placed.sandbox
  const onTwoAxes = placedTotal + r.unplaced
  return [
    `scans with a hunt layer:      ${r.scansWithHunt}`,
    `  …that produced candidates:  ${r.scansWithGateResult}`,
    `  …that ran the LUM-798 gate: ${r.scansWithResolution}`,
    `  …of those, legacy tally:    ${r.scansWithLegacyTally} (tiers not comparable — excluded from the axes below)`,
    `candidates:                   ${r.candidates}`,
    `rejection rate:               ${r.rejectionRate === null ? 'n/a (no candidate submitted)' : `${(r.rejectionRate * 100).toFixed(1)}%`}`,
    `falsifier verdicts on record: ${r.falsifierVerdicts}`,
    '',
    `placement axis (${onTwoAxes} candidates on the two-axis tally):`,
    `  placed by subgraph:         ${r.placed.subgraph}`,
    `  placed by sink rule:        ${r.placed.sinkRule}`,
    `  placed by sandbox sighting: ${r.placed.sandbox}`,
    `  never placed:               ${r.unplaced}`,
    'outcome axis:',
    `  survived every check:       ${r.accepted}`,
    `  placed, then rejected:      ${placedTotal - r.accepted}`,
    '',
    'rejections by FULL reason (the symbol is the point):',
    ...r.reasons.map(x => `  ${String(x.count).padStart(3)}  ${x.reason}`),
  ]
}
