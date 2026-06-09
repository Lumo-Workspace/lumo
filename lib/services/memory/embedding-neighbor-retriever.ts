import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lexicalNeighborRetriever } from './neighbor-retriever'
import type {
  NeighborRetriever,
  RetrieveContext,
  ScoredNeighbor,
} from './neighbor-retriever'

/**
 * Cosine-similarity floor for the embedding path (qwen3-embedding-0.6b).
 *
 * Calibrated by the LUM-329 eval harness over a 54-case in-domain corpus
 * (39 positive pairs). qwen cosines sit high, so the old 0.6 placeholder admitted
 * noise: the precision/recall F1 knee sits at 0.78 (P=0.478, R=0.846, F1=0.611),
 * with F1 within ~0.01 across the 0.76–0.82 band. 0.78 keeps ~85% of same-fact
 * neighbors while roughly doubling precision vs 0.6.
 *
 * Tradeoff note: the SF eval found the reconcile LLM never makes a destructive
 * error (non-conflict protection 1.000), so a recall-favoring floor (~0.74,
 * R=0.897) is defensible — but the eval did not measure whether a *distractor*
 * shown to the LLM provokes a spurious UPDATE, so we hold at the balanced knee.
 * Re-derive via `npx tsx scripts/eval/memory/run.ts`; the floor is model-coupled,
 * so a model swap re-opens the sweep.
 */
export const EMBEDDING_SCORE_FLOOR = 0.78

/** Result the embedding path returns so the composite can tell a cold/cold-
 * starting corpus (fall back to lexical) from a genuinely empty result. */
interface EmbeddingResult {
  neighbors: ScoredNeighbor[]
  scopeHasEmbeddings: boolean
}

async function retrieveEmbedding(
  ctx: RetrieveContext
): Promise<EmbeddingResult> {
  const { neighbors, scopeHasEmbeddings } =
    await memoryRepository.findNeighborEmbeddings({
      scope: ctx.scope,
      queryVector: ctx.query.vector!, // caller guarantees presence
      k: ctx.k,
    })
  const filtered = neighbors
    .filter(n => n.score >= EMBEDDING_SCORE_FLOOR)
    .map(n => ({
      id: n.id,
      category: n.category,
      content: n.content,
      score: n.score,
    }))
  return { neighbors: filtered, scopeHasEmbeddings }
}

/** Embedding-only retriever (used by the composite; exported for tests). */
export const embeddingNeighborRetriever: NeighborRetriever = {
  async retrieve(ctx) {
    const { neighbors } = await retrieveEmbedding(ctx)
    return neighbors
  },
}

/**
 * Composite: embedding path when usable, else lexical fallback. Falls back when
 * (a) no query vector (no key / embed failed upstream), (b) the embedding query
 * throws, or (c) the scope has NO embeddings yet (cold/backfilling corpus). Does
 * NOT fall back when the scope is embedded but nothing clears the floor — that's
 * a genuine "no neighbor", and the candidate should become an ADD.
 */
export const compositeNeighborRetriever: NeighborRetriever = {
  async retrieve(ctx) {
    if (!ctx.query.vector) return lexicalNeighborRetriever.retrieve(ctx)
    try {
      const { neighbors, scopeHasEmbeddings } = await retrieveEmbedding(ctx)
      if (!scopeHasEmbeddings) return lexicalNeighborRetriever.retrieve(ctx)
      return neighbors
    } catch {
      return lexicalNeighborRetriever.retrieve(ctx)
    }
  },
}
