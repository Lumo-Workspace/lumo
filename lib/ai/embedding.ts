import { embedMany } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'

/** Vercel AI Gateway embedding model. Needs AI_GATEWAY_API_KEY locally; prod
 * authenticates via Vercel OIDC.
 *
 * Model selection confirmed by the LUM-329 eval harness: 0.6b is kept over the
 * larger qwen3 variants. On the in-domain corpus 0.6b had the BEST rank-1
 * recall (0.718 vs 4b 0.692, 8b 0.590) and the best separation margin
 * (mean 0.079 vs 0.078 / 0.071) — the bigger models did NOT discriminate
 * same-fact-vs-distractor better, while costing 2.5×/4× the dimension
 * (2560 / 4096 vs 1024). Re-run the internal memory eval (LUM-538) to re-compare;
 * swapping the model also requires changing EMBEDDING_DIM + the pgvector column. */
export const EMBEDDING_MODEL = 'alibaba/qwen3-embedding-0.6b'
/** qwen3-embedding-0.6b native output dimension (matches the pgvector column). */
export const EMBEDDING_DIM = 1024

/**
 * Embed N texts in a single gateway call. Returns one 1024-d vector per input
 * (order-preserving). Throws on gateway failure — callers (write-path stamping,
 * retrieval) catch and degrade (skip embedding / fall back to lexical).
 */
export async function embedTexts(values: string[]): Promise<number[][]> {
  if (values.length === 0) return []
  const { embeddings } = await embedMany({
    model: gateway.textEmbeddingModel(EMBEDDING_MODEL),
    values,
  })
  return embeddings
}
