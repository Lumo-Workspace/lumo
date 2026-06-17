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

export interface VecItem {
  id: string
  vector: number[]
}

/**
 * Group items into near-duplicate clusters: connected components where an edge
 * joins two items with cosine similarity >= `floor`. Only clusters of size >= 2
 * are returned (a singleton is not a duplicate of anything). Each cluster's ids
 * are sorted, and the clusters are sorted by their first id, so the output is
 * deterministic. Union-find with path compression — O(n^2) edge scan, fine for
 * eval-corpus sizes.
 */
export function nearDupClusters(items: VecItem[], floor: number): string[][] {
  const parent = new Map<string, string>()
  for (const it of items) parent.set(it.id, it.id)
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    // Path compression.
    let cur = x
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a: string, b: string): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (cosineSimilarity(items[i]!.vector, items[j]!.vector) >= floor) {
        union(items[i]!.id, items[j]!.id)
      }
    }
  }

  const groups = new Map<string, string[]>()
  for (const it of items) {
    const root = find(it.id)
    const g = groups.get(root) ?? []
    g.push(it.id)
    groups.set(root, g)
  }
  return [...groups.values()]
    .filter(g => g.length >= 2)
    .map(g => [...g].sort())
    .sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0))
}

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
