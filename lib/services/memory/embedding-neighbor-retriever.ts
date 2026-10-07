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
 * noise; the precision/recall F1 *knee* sits at 0.78 (P=0.478, R=0.846, F1=0.611).
 *
 * LUM-538 — recall-favoring move OFF the F1 knee (0.78 → 0.74). The knee
 * optimizes balanced F1, but for reconcile-on-write the asymmetry is the point:
 * a near-duplicate the floor filters out NEVER reaches the reconcile LLM, so it
 * silently becomes a spurious ADD (this is the diagnosed root cause of the
 * 40–60% near-dup leak — retrieval, not the LLM, is the bottleneck). At 0.78 the
 * gate already drops ~15% of same-fact pairs (R=0.846); 0.74 lifts that to
 * R=0.897 (recall +0.05) at a precision cost (P 0.478 → 0.427, i.e. a few more
 * distractors shown to the LLM). That cost is bounded by the LLM's measured
 * non-destructiveness — the SF eval found non-conflict protection = 1.000 (it
 * does not SUPERSEDE/DELETE a non-conflicting neighbor), and high-trust rows are
 * additionally SUPERSEDE-guarded (LUM-325). 0.74 stays above the task→fragment
 * abstention ceiling (max negative-control cosine 0.673, retrieve.frozen test),
 * so lowering it does not break injection abstention.
 *
 * NOT-yet-measured: whether a distractor newly admitted in the 0.74–0.78 band
 * provokes a spurious UPDATE (a refine, non-destructive, but still drift). The
 * SF eval (key-gated) should be re-run to confirm op-accuracy holds at 0.74
 * before lowering further. Re-derive the sweep via
 * the internal LUM-538 memory eval, which also holds the near-dup retrieval
 * recall regression. Model-coupled — a
 * model swap re-opens the sweep.
 */
export const EMBEDDING_SCORE_FLOOR = 0.74

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
