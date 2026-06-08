import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lexicalNeighborRetriever } from './neighbor-retriever'
import type {
  NeighborRetriever,
  RetrieveContext,
  ScoredNeighbor,
} from './neighbor-retriever'

/**
 * Cosine-similarity floor for the embedding path. UNRELATED sentence
 * embeddings sit around 0.3–0.5 cosine, so the lexical 0.3 floor would admit
 * noise here — the embedding path needs its own, higher bar.
 * Placeholder — calibrate via the LUM-329 eval harness.
 */
export const EMBEDDING_SCORE_FLOOR = 0.6

/** Result the embedding path returns so the composite can tell a cold/cold-
 * starting corpus (fall back to lexical) from a genuinely empty result. */
interface EmbeddingResult {
  neighbors: ScoredNeighbor[]
  scopeHasEmbeddings: boolean
}

async function retrieveEmbedding(ctx: RetrieveContext): Promise<EmbeddingResult> {
  const { neighbors, scopeHasEmbeddings } =
    await memoryRepository.findNeighborEmbeddings({
      scope: ctx.scope,
      queryVector: ctx.query.vector!, // caller guarantees presence
      k: ctx.k,
    })
  const filtered = neighbors
    .filter(n => n.score >= EMBEDDING_SCORE_FLOOR)
    .map(n => ({ id: n.id, category: n.category, content: n.content, score: n.score }))
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
