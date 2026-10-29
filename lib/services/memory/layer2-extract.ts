import { MEMORY_JUDGE_MODEL } from '@/lib/ai/models'
import { structuredOutputCallOptions } from '@/lib/ai/structured-output-routing'
import { z } from 'zod'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'
import { buildLayer2ExtractPrompt } from './layer2-prompt'
import { buildLayer2ReconcilePrompt } from './layer2-reconcile-prompt'
import {
  LOOSE_RECONCILE_OUTPUT,
  parseReconcileOperations,
} from './reconcile-parse'
import type { Layer2Input } from './layer2-input'
import type { ScoredNeighbor } from './neighbor-retriever'

// ── Output schema ─────────────────────────────────────────────────────────────

const memoryCategorySchema = z.enum([
  'TRAP',
  'DECISION',
  'CONVENTION',
  'PROCEDURAL',
])

/**
 * Layer 2 emits a smaller op vocabulary than Layer 1:
 *
 * - ADD creates a new PROJECT-scope memory. scope is implicit — Layer 2 only
 *   writes PROJECT, so there is no scope field on the op.
 * - UPDATE refines an existing PROJECT-scope memory (same id+content shape
 *   as Layer 1 UPDATE). Same-category replacement only.
 * - SUPERSEDE is the contradiction path: when a new observation directly
 *   contradicts an existing PROJECT memory, SUPERSEDE atomically replaces the
 *   old content via supersedeInPlace (soft-retract + new version). Like
 *   UPDATE, content must validate against the existing row's category.
 *   Layer 2 still has NO hard DELETE — retracting without a replacement is
 *   deferred to a user action or a future clean-up pass.
 * - NOOP signals "nothing new to consolidate this run".
 */
export const layer2OperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ADD'),
    category: memoryCategorySchema,
    content: z.unknown(),
    // LUM-280: ids of the source TASK memories this promotion was synthesized
    // from. Optional — the model may omit them; apply-side hard-validates each
    // against the consolidation input window and drops anything not present.
    sourceMemoryIds: z.array(z.string().min(1)).optional(),
  }),
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
  z.object({
    type: z.literal('NOOP'),
  }),
])

export const layer2OutputSchema = z.object({
  operations: z.array(layer2OperationSchema),
})

export type Layer2Operation = z.infer<typeof layer2OperationSchema>
export type Layer2Output = z.infer<typeof layer2OutputSchema>

// ── Pass 1: candidate extraction ───────────────────────────────────────────

const MODEL_ID = MEMORY_JUDGE_MODEL

export const layer2CandidateSchema = z.object({
  category: memoryCategorySchema,
  content: z.unknown(),
  sourceMemoryIds: z.array(z.string().min(1)).optional(),
})
export const layer2CandidatesOutputSchema = z.object({
  candidates: z.array(layer2CandidateSchema),
})
export type Layer2Candidate = z.infer<typeof layer2CandidateSchema>

/**
 * Pass 1: scan recurring TASK-scope memories and emit candidate PROJECT
 * lessons — blind to existing PROJECT memories (reconciliation is Pass 2).
 * Each candidate carries sourceMemoryIds (recurrence evidence / provenance).
 * Failures degrade to [].
 */
export async function extractLayer2Candidates(
  input: Layer2Input
): Promise<Layer2Candidate[]> {
  const { system, user } = buildLayer2ExtractPrompt(input)
  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      ...structuredOutputCallOptions(MODEL_ID),
      schema: layer2CandidatesOutputSchema,
      system,
      prompt: user,
    })
    return object.candidates
  } catch (error) {
    console.error(
      `[memory.layer2] candidate extraction failed project=${input.project.id}:`,
      error
    )
    return []
  }
}

// ── Pass 2: reconciliation ──────────────────────────────────────────────────

export interface ReconcileLayer2Input {
  project: { id: string; name: string }
  candidates: Layer2Candidate[]
  neighborsByCandidate: ScoredNeighbor[][]
}

/**
 * Pass 2: given each candidate PROJECT lesson and its top-k neighbors (existing
 * PROJECT memories), decide the operation (ADD / UPDATE / SUPERSEDE / NOOP — no
 * DELETE at Layer 2). Failures degrade to [].
 */
export async function reconcileLayer2Candidates(
  input: ReconcileLayer2Input
): Promise<Layer2Operation[]> {
  const { system, user } = buildLayer2ReconcilePrompt({
    project: input.project,
    candidates: input.candidates,
    neighborsByCandidate: input.neighborsByCandidate,
  })
  try {
    // LUM-335: same per-op resilience as layer1 — loose array schema to
    // generateObject, then strict per-element validation (alias + drop garbage).
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      ...structuredOutputCallOptions(MODEL_ID),
      schema: LOOSE_RECONCILE_OUTPUT,
      system,
      prompt: user,
    })
    return parseReconcileOperations(
      object.operations,
      layer2OperationSchema,
      'memory.layer2'
    )
  } catch (error) {
    console.error(
      `[memory.layer2] reconciliation failed project=${input.project.id}:`,
      error
    )
    return []
  }
}
