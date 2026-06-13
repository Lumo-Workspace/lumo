import type { AgentRunMemberStat } from '../../types'

/** One person's cross-model token total + share of the task grand total.
 *  `total` is summed across that member's models — the same task-level caliber
 *  as the delivery card's "used" figure (the "cross-model not summable" caveat
 *  is about comparing models, not about per-person attribution share). */
export interface PerMemberSummaryRow {
  workspaceMemberId: string
  name: string
  imageUrl: string
  total: number
  /** Fraction of the grand total, 0..1. 0 when the grand total is 0. */
  pct: number
}

/** Fold `perMember` (already spend-desc) into per-person totals + shares.
 *  Order is preserved; no mutation. */
export function summarizePerMember(
  perMember: AgentRunMemberStat[]
): PerMemberSummaryRow[] {
  const base = perMember.map(mem => ({
    workspaceMemberId: mem.workspaceMemberId,
    name: mem.name,
    imageUrl: mem.imageUrl,
    total: mem.byModel.reduce((sum, b) => sum + b.total, 0),
  }))
  const grand = base.reduce((sum, r) => sum + r.total, 0)
  return base.map(r => ({ ...r, pct: grand > 0 ? r.total / grand : 0 }))
}
