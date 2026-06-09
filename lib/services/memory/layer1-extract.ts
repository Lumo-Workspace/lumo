import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { buildLayer1ExtractPrompt } from './layer1-prompt'
import { buildLayer1ReconcilePrompt } from './layer1-reconcile-prompt'
import type { Layer1Input } from './layer1-input'
import type { ScoredNeighbor } from './neighbor-retriever'

// ── Output schema ─────────────────────────────────────────────────────────────

const memoryCategorySchema = z.enum([
  'TRAP',
  'DECISION',
  'CONVENTION',
  'PROCEDURAL',
])

/**
 * The LLM output is intentionally loose on the `content` field — we accept
 * any JSON value here and re-validate per-category with `parseMemoryContent`
 * inside the apply step. This keeps the LLM response permissive (so a
 * minor shape error on one op doesn't reject the whole batch) while still
 * gating writes on the strict per-category Zod schemas.
 */
const memoryScopeSchema = z.enum(['TASK', 'PROJECT'])

export const layer1OperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ADD'),
    category: memoryCategorySchema,
    scope: memoryScopeSchema.optional(),
    content: z.unknown(),
  }),
  z.object({
    type: z.literal('UPDATE'),
    id: z.string().min(1),
    content: z.unknown(),
  }),
  z.object({
    type: z.literal('DELETE'),
    id: z.string().min(1),
  }),
  z.object({
    type: z.literal('SUPERSEDE'),
    id: z.string().min(1),
    content: z.unknown(),
  }),
  z.object({
    type: z.literal('NOOP'),
  }),
])

export const layer1OutputSchema = z.object({
  operations: z.array(layer1OperationSchema),
})

export type Layer1Operation = z.infer<typeof layer1OperationSchema>
export type Layer1Output = z.infer<typeof layer1OutputSchema>

// ── Pass 1: candidate extraction ───────────────────────────────────────────

export const layer1CandidateSchema = z.object({
  category: memoryCategorySchema,
  scope: memoryScopeSchema.optional(),
  content: z.unknown(),
})

export const layer1CandidatesOutputSchema = z.object({
  candidates: z.array(layer1CandidateSchema),
})

export type Layer1Candidate = z.infer<typeof layer1CandidateSchema>

const MODEL_ID = 'deepseek/deepseek-v4-flash'

// ── Pass 2: reconciliation ──────────────────────────────────────────────────

export interface ReconcileLayer1Input {
  task: { id: string; title: string; description: string | null }
  candidates: Layer1Candidate[]
  neighborsByCandidate: ScoredNeighbor[][]
}

/**
 * Pass 2: given each candidate and its top-k neighbors, decide the operation
 * (ADD / UPDATE / DELETE / SUPERSEDE / NOOP). Failures degrade to [].
 */
export async function reconcileLayer1Candidates(
  input: ReconcileLayer1Input
): Promise<Layer1Operation[]> {
  const { system, user } = buildLayer1ReconcilePrompt({
    task: { title: input.task.title, description: input.task.description },
    candidates: input.candidates,
    neighborsByCandidate: input.neighborsByCandidate,
  })
  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: layer1OutputSchema,
      system,
      prompt: user,
    })
    return object.operations
  } catch (error) {
    console.error(
      `[memory.layer1] reconciliation failed task=${input.task.id}:`,
      error
    )
    return []
  }
}

/**
 * Pass 1: read the turn and emit candidate facts worth remembering — blind to
 * existing memories. Reconciliation (ADD vs UPDATE vs SUPERSEDE vs NOOP) is a
 * separate pass that sees each candidate's neighbors. Failures degrade to [].
 */
export async function extractLayer1Candidates(
  input: Layer1Input
): Promise<Layer1Candidate[]> {
  const { system, user } = buildLayer1ExtractPrompt({
    task: { title: input.task.title, description: input.task.description },
    turnEvents: input.turnEvents,
  })
  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: layer1CandidatesOutputSchema,
      system,
      prompt: user,
    })
    return object.candidates
  } catch (error) {
    console.error(
      `[memory.layer1] candidate extraction failed task=${input.task.id}:`,
      error
    )
    return []
  }
}
