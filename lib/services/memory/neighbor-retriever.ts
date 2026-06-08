import type { MemoryCategory } from '@prisma/client'
import { bigramSimilarity } from '@/lib/similarity'
import { memoryContentToText } from '@/lib/memory/content-text'

/** Top-k neighbors fetched per candidate (Mem0 uses top-10). */
export const NEIGHBOR_K = 10

/** A small bump so a same-category near-duplicate outranks a cross-category
 * coincidence. SUPERSEDE/UPDATE can only target a same-category neighbor (apply
 * re-validates against the existing row's category), so same-category is the
 * decision-relevant case. */
const SAME_CATEGORY_BOOST = 0.1

/** Below this, a "neighbor" is lexical noise — feeding it to the LLM only
 * invites spurious UPDATE/SUPERSEDE. Calibrated so incidental bigram overlap
 * from common letter pairs (spaces, vowels) does not constitute a neighbor,
 * even after the same-category boost is applied; revisit via the LUM-329
 * eval harness. */
const SCORE_FLOOR = 0.3

export interface NeighborPoolItem {
  id: string
  category: MemoryCategory
  content: unknown
}

export interface NeighborQuery {
  category: MemoryCategory
  text: string
}

export interface ScoredNeighbor extends NeighborPoolItem {
  score: number
}

/**
 * Rank existing memories by similarity to a candidate fact and return the
 * top-k. The ONLY implementation shipped in LUM-324 is lexical
 * (`lexicalNeighborRetriever`); the interface exists so an
 * `EmbeddingNeighborRetriever` (pgvector) can replace it later without
 * touching callers. See the LUM-324 DECISION memory for the swap trigger.
 */
export interface NeighborRetriever {
  retrieve(
    query: NeighborQuery,
    pool: NeighborPoolItem[],
    k: number
  ): ScoredNeighbor[]
}

export const lexicalNeighborRetriever: NeighborRetriever = {
  retrieve(query, pool, k) {
    const scored: ScoredNeighbor[] = []
    for (const item of pool) {
      const base = bigramSimilarity(
        query.text,
        memoryContentToText(item.category, item.content)
      )
      if (base <= 0) continue
      // Allow boosted score to exceed 1.0 — scores are internal ranking values
      // only, never displayed. Capping at 1.0 would make the boost a no-op
      // when base already hits the containment ceiling.
      const score =
        item.category === query.category
          ? base + SAME_CATEGORY_BOOST
          : base
      if (score < SCORE_FLOOR) continue
      scored.push({ ...item, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, k)
  },
}
