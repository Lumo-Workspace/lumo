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
  /** Present only when an embedding was computed for this candidate. */
  vector?: number[] | undefined
}

export interface ScoredNeighbor extends NeighborPoolItem {
  score: number
}

export type NeighborScope =
  | { kind: 'TASK'; taskId: string }
  | { kind: 'PROJECT'; projectId: string }

export interface RetrieveContext {
  query: NeighborQuery
  /** In-memory pool for the lexical path. */
  pool: NeighborPoolItem[]
  /** DB scope for the embedding path (mirrors the pool's candidate set). */
  scope: NeighborScope
  k: number
}

/**
 * Rank existing memories by similarity to a candidate fact and return the
 * top-k. The lexical implementation (`lexicalNeighborRetriever`) is the
 * baseline; `EmbeddingNeighborRetriever` (pgvector) slots in via the same
 * interface.
 *
 * Upgrade trigger (calibrated, LUM-329): recall@k is NOT the discriminating
 * lever at current pool size — over a ~50-memory scope both lexical and
 * embedding reach recall@10=1.0 (lexical recall@1/@3 = 0.667/0.923, embedding
 * recall@1 = 0.718; embedding's edge is ~+0.05 at rank-1 only). So the swap
 * stays gated on the pool-size heuristic (>50 PROJECT memories), where lexical
 * bigram discrimination is expected to degrade. Revisit a recall@k threshold
 * only if a larger eval pool shows lexical recall@10 actually dropping.
 */
export interface NeighborRetriever {
  retrieve(ctx: RetrieveContext): Promise<ScoredNeighbor[]>
}

export const lexicalNeighborRetriever: NeighborRetriever = {
  async retrieve(ctx) {
    const { query, pool, k } = ctx
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
        item.category === query.category ? base + SAME_CATEGORY_BOOST : base
      if (score < SCORE_FLOOR) continue
      scored.push({ ...item, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, k)
  },
}
