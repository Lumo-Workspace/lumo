/**
 * LUM-541 (P5) — near-duplicate clustering, promoted from the eval harness
 * (internal near-dup-cluster eval, LUM-538) into `lib/` so the
 * production batch-consolidation sweep and the offline eval metric share ONE
 * clustering implementation. The eval module re-exports `nearDupClusters` /
 * `VecItem` from here, so the LUM-538 near-dup regression test keeps measuring
 * the exact function the live sweep uses (and the human's before/after count is
 * the same metric).
 *
 * Both functions are pure functions of (vectors, floor) — no gateway, no DB —
 * so a test pins them to a fixed literal target rather than a vs-origin/main
 * self-comparison.
 */

/** Cosine similarity matching pgvector's `1 - (a <=> b)`: dot / (‖a‖‖b‖).
 * Returns 0 for a zero-magnitude vector (never NaN/throw). Kept local to `lib/`
 * so this layer never imports eval-only `scripts/` code. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    dot += ai * bi
    na += ai * ai
    nb += bi * bi
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

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
 * the per-project corpus sizes the sweep runs over.
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
