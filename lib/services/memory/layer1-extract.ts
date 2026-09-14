import { FAST_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { buildLayer1ExtractPrompt } from './layer1-prompt'
import { buildLayer1ReconcilePrompt } from './layer1-reconcile-prompt'
import {
  LOOSE_RECONCILE_OUTPUT,
  parseReconcileOperations,
} from './reconcile-parse'
import type { Layer1Input } from './layer1-input'
import type { ScoredNeighbor } from './neighbor-retriever'
import { cleanTurnSummary } from '@/lib/services/meta-reasoning'

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

// ── Pass 1: combined turn extraction (LUM-773) ──────────────────────────────

export const layer1CandidateSchema = z.object({
  category: memoryCategorySchema,
  scope: memoryScopeSchema.optional(),
  content: z.unknown(),
  /**
   * Verbatim snippet from the turn that backs the candidate. Required by the
   * prompt; optional in the schema so a missing quote discards ONE candidate
   * (in `groundCandidatesLocally`) instead of failing the whole object.
   */
  quote: z.string().optional(),
})

/**
 * One call per turn yields both the one-line turn summary (formerly the
 * separate turn-summary.service flash call) and the memory candidates.
 */
export const layer1TurnOutputSchema = z.object({
  turnSummary: z.string().optional(),
  candidates: z.array(layer1CandidateSchema),
})

export type Layer1Candidate = z.infer<typeof layer1CandidateSchema>

export interface Layer1TurnExtraction {
  /** Cleaned one-liner (cleanTurnSummary), or null when absent / rejected. */
  summary: string | null
  candidates: Layer1Candidate[]
}

const MODEL_ID = FAST_MODEL

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
    // LUM-335: hand generateObject a LOOSE array schema (raw objects) so one
    // malformed element can't throw and nuke the whole turn; validate each op
    // individually afterwards (alias `operation`→`type`, drop only garbage).
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: LOOSE_RECONCILE_OUTPUT,
      system,
      prompt: user,
    })
    return parseReconcileOperations(
      object.operations,
      layer1OperationSchema,
      'memory.layer1'
    )
  } catch (error) {
    console.error(
      `[memory.layer1] reconciliation failed task=${input.task.id}:`,
      error
    )
    return []
  }
}

/**
 * Pass 1 (LUM-773): read the turn ONCE and emit (a) the one-line turn summary
 * and (b) candidate facts worth remembering, each with a verbatim quote —
 * blind to existing memories. Reconciliation (ADD vs UPDATE vs SUPERSEDE vs
 * NOOP) is a separate pass that sees each candidate's neighbors. Failures
 * degrade to an empty extraction.
 */
export async function extractLayer1Turn(
  input: Layer1Input
): Promise<Layer1TurnExtraction> {
  const { system, user } = buildLayer1ExtractPrompt({
    task: { title: input.task.title, description: input.task.description },
    turnEvents: input.turnEvents,
  })
  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: layer1TurnOutputSchema,
      system,
      prompt: user,
    })
    return {
      summary: cleanTurnSummary(object.turnSummary ?? ''),
      candidates: object.candidates,
    }
  } catch (error) {
    console.error(
      `[memory.layer1] turn extraction failed task=${input.task.id}:`,
      error
    )
    return { summary: null, candidates: [] }
  }
}
