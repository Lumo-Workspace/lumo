import { embedMany } from 'ai'
import { gateway } from '@ai-sdk/gateway'

/** Vercel AI Gateway embedding model. Needs AI_GATEWAY_API_KEY locally; prod
 * authenticates via Vercel OIDC. */
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
