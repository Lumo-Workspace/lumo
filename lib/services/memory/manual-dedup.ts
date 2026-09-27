import { MEMORY_JUDGE_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { parseMemoryContent } from '@/lib/memory/schemas'
import { compositeNeighborRetriever } from './embedding-neighbor-retriever'
import { NEIGHBOR_K } from './neighbor-retriever'
import {
  LOOSE_RECONCILE_OUTPUT,
  parseReconcileOperations,
} from './reconcile-parse'
import type { NeighborScope, ScoredNeighbor } from './neighbor-retriever'
import type { MemoryCategory } from '@prisma/client'
import type { MemoryContent } from '@/lib/memory/schemas'

/** deepseek-v4-pro via the gateway (LUM-591) — same model as the auto reconcile path. */
const MODEL_ID = MEMORY_JUDGE_MODEL

/**
 * Op vocabulary for the manual single-candidate dedup. Defined LOCALLY (not
 * imported from layer2-extract) because that module static-imports the gateway;
 * keeping the schema here lets this module stay statically importable in jest.
 * No DELETE — a manual add never retracts an unrelated existing memory.
 */
const manualDedupOpSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ADD') }),
  z.object({
    type: z.literal('UPDATE'),
    id: z.string().min(1),
    content: z.unknown(),
  }),
  z.object({
    type: z.literal('SUPERSEDE'),
    id: z.string().min(1),
    content: z.unknown(),
  }),
  z.object({ type: z.literal('NOOP') }),
])

export type ManualDedupResolution =
  | { kind: 'ADD' }
  | { kind: 'UPDATE'; id: string; content: MemoryContent }
  | { kind: 'SUPERSEDE'; id: string; content: MemoryContent }
  | { kind: 'NOOP'; id: string }

export interface ResolveManualDedupInput {
  category: MemoryCategory
  /** The (already English-canonicalized) candidate content being added. */
  content: unknown
  /** Flattened candidate text — query for retrieval. */
  candidateText: string
  /** Candidate embedding when available (else lexical retrieval). */
  candidateVector: number[] | undefined
  /** ACTIVE existing memories in scope (lexical pool). */
  pool: Array<{ id: string; category: MemoryCategory; content: unknown }>
  scope: NeighborScope
}

function buildPrompt(
  category: MemoryCategory,
  content: unknown,
  neighbors: ScoredNeighbor[]
): { system: string; user: string } {
  const system =
    'You de-duplicate a single new developer-memory record against its nearest ' +
    'existing records. Return a JSON object {"operations":[op]} with EXACTLY ONE ' +
    'operation, where op.type is one of:\n' +
    '- "NOOP": the new record says nothing the listed records do not already say (duplicate).\n' +
    '- "UPDATE": the new record refines/extends ONE listed record — set op.id to that record id and op.content to the merged content (same field shape).\n' +
    '- "SUPERSEDE": the new record directly CONTRADICTS ONE listed record — set op.id to that record id and op.content to the corrected content.\n' +
    '- "ADD": the new record is distinct from all listed records.\n' +
    'op.id MUST be one of the listed record ids. Use the discriminator key "type" ' +
    '(never "operation"). Prefer ADD when unsure.'
  const user = JSON.stringify({
    category,
    newRecord: content,
    existingRecords: neighbors.map(n => ({
      id: n.id,
      category: n.category,
      content: n.content,
    })),
  })
  return { system, user }
}

/**
 * Hybrid-gated dedup for a manual memory add (LUM-336). Retrieve top-k neighbors
 * (embedding → lexical); if none clear the floor, ADD (zero LLM). Otherwise ask
 * the reconcile LLM for a single op and map it to a resolution. Any uncertainty
 * (LLM error, unknown target id, content failing the category schema, NOOP with
 * no neighbor) fails open to ADD so a manual add is never silently dropped.
 *
 * Gateway is dynamic-imported INSIDE the function (jest-safety; matches the auto
 * path's deferral pattern).
 */
export async function resolveManualDedup(
  input: ResolveManualDedupInput
): Promise<ManualDedupResolution> {
  let neighbors: ScoredNeighbor[]
  try {
    neighbors = await compositeNeighborRetriever.retrieve({
      query: {
        category: input.category,
        text: input.candidateText,
        vector: input.candidateVector,
      },
      pool: input.pool,
      scope: input.scope,
      k: NEIGHBOR_K,
    })
  } catch (err) {
    logger.warn(
      '[memory.manual-dedup] retrieval failed — defaulting to ADD:',
      err instanceof Error ? err.message : err
    )
    return { kind: 'ADD' }
  }
  if (neighbors.length === 0) return { kind: 'ADD' }

  const neighborIds = new Set(neighbors.map(n => n.id))
  const { system, user } = buildPrompt(input.category, input.content, neighbors)

  try {
    const { generateObject } = await import('ai')
    const { gateway } = await import('@/lib/ai/gateway')
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: LOOSE_RECONCILE_OUTPUT,
      system,
      prompt: user,
    })
    const ops = parseReconcileOperations(
      object.operations,
      manualDedupOpSchema,
      'memory.manual-dedup'
    )
    // The prompt asks for EXACTLY ONE op; if the LLM over-produces we take the
    // first and log the rest (diagnostic — explains why a given neighbor id was
    // chosen on a later trace).
    if (ops.length > 1) {
      logger.warn(
        `[memory.manual-dedup] LLM returned ${ops.length} ops, using first:`,
        ops.map(o => o.type).join(',')
      )
    }
    const op = ops[0]
    if (!op || op.type === 'ADD') return { kind: 'ADD' }
    // NOOP carries no id (matches the layer1/layer2 batch schema). The duplicate
    // is attributed to the TOP-scored neighbor — an intentional approximation
    // used only for the CLI "duplicate of <id>" message, not for any write.
    if (op.type === 'NOOP') return { kind: 'NOOP', id: neighbors[0]!.id }
    // UPDATE / SUPERSEDE — target must be a real neighbor; content must validate
    // against the candidate category (apply re-validates against the existing
    // row's category, which equals candidate category for a same-category merge).
    if (!neighborIds.has(op.id)) return { kind: 'ADD' }
    let validated: MemoryContent
    try {
      validated = parseMemoryContent(input.category, op.content)
    } catch {
      return { kind: 'ADD' }
    }
    return op.type === 'UPDATE'
      ? { kind: 'UPDATE', id: op.id, content: validated }
      : { kind: 'SUPERSEDE', id: op.id, content: validated }
  } catch (err) {
    logger.warn(
      '[memory.manual-dedup] reconcile failed — defaulting to ADD:',
      err instanceof Error ? err.message : err
    )
    return { kind: 'ADD' }
  }
}
