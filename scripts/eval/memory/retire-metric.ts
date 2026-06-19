import type { RetireCandidate } from '@/lib/services/memory/retire.service'

/**
 * LUM-540 (P4a) — the "错误条目数" half of the memory entropy ledger. Counts the
 * memories currently flagged for retirement by either signal (low judged-used
 * track record OR curation-judge clearly-wrong). Reported by the eval harness
 * alongside the LUM-538 residual near-dup cluster count so a single run shows
 * both halves of "近重复簇数 + 错误条目数下降且不反弹".
 */
export function errorEntryCount(candidates: RetireCandidate[]): number {
  return candidates.length
}

/**
 * One harness line carrying both halves of the entropy ledger: dedup (residual
 * near-dup clusters, LUM-538) and retire (error/stale entries, LUM-540). Keeping
 * them on one line makes the milestone acceptance bar observable from one run.
 */
export function formatEntropyLedgerLine(input: {
  nearDupClusters: number
  errorEntries: number
}): string {
  return `  residual near-dup clusters: ${input.nearDupClusters} · retire/error entries: ${input.errorEntries}`
}
