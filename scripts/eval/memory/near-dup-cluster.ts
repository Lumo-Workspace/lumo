/**
 * LUM-538 — near-duplicate cluster metric for the memory eval harness.
 *
 * The milestone acceptance is phrased as "near-duplicate cluster count drops
 * and does not rebound". The pre-existing AR metric reports retrieval F1/recall
 * but never a cluster count, so this module adds two standing, deterministic
 * (offline, no gateway) measurements over the frozen vector fixture:
 *
 *  1. `nearDupClusters` — connected components of mutually-near-duplicate
 *     memories at a given cosine floor (the "how much residual duplication is
 *     in this corpus" view). Generic over any embedded item list; over the eval
 *     corpus it operates on the labeled near-dup pairs.
 *  2. `nearDupRetrievalReport` — the gate view that maps directly onto the
 *     diagnosed root cause: a labeled near-dup pair is *caught* (its true
 *     neighbor reaches the reconcile LLM, which can then merge it) iff
 *     cosine(candidate, existing) >= floor. A *missed* pair never reaches the
 *     LLM and becomes a spurious ADD — i.e. a residual near-duplicate. Lowering
 *     the floor lifts the caught rate; this is what `EMBEDDING_SCORE_FLOOR`
 *     trades off (LUM-538).
 *
 * Both are pure functions of (vectors, floor) so the regression test pins them
 * to a fixed literal target, never a vs-origin/main self-comparison.
 */
import { cosineSimilarity } from './ar-metrics'

// LUM-541: `nearDupClusters` / `VecItem` now live in `lib/services/memory/near-dup.ts`
// so the production batch-consolidation sweep and this eval metric share one
// clustering implementation. Re-exported here to keep the LUM-538 regression
// test (and every other importer of this path) unchanged.
export { nearDupClusters } from '@/lib/services/memory/near-dup'
export type { VecItem } from '@/lib/services/memory/near-dup'

export interface NearDupPair {
  id: string
  candidate: number[]
  existing: number[]
}

export interface NearDupRetrievalReport {
  total: number
  /** Pairs whose true neighbor clears the floor → reach the reconcile LLM. */
  caught: number
  /** Pairs filtered out at the floor → never reach the LLM → spurious ADD. */
  missed: number
  /** caught / total — the retrieval-gate recall of true near-duplicates. */
  recall: number
  /** Ids of the missed pairs (each a residual near-duplicate cluster). */
  missedIds: string[]
}

/**
 * Retrieval-gate report over labeled near-duplicate pairs. `caught` = the pair's
 * candidate retrieves its own existing neighbor at or above `floor`. This is the
 * necessary condition for reconcile to merge it: the diagnosis (LUM-538) is that
 * misses here, not LLM errors, drive the near-dup leak — a filtered pair is
 * never shown to the LLM at all.
 */
export function nearDupRetrievalReport(
  pairs: NearDupPair[],
  floor: number
): NearDupRetrievalReport {
  const missedIds: string[] = []
  let caught = 0
  for (const p of pairs) {
    if (cosineSimilarity(p.candidate, p.existing) >= floor) caught++
    else missedIds.push(p.id)
  }
  const total = pairs.length
  return {
    total,
    caught,
    missed: total - caught,
    recall: total === 0 ? 1 : caught / total,
    missedIds,
  }
}
