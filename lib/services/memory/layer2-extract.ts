import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { buildLayer2Prompt } from './layer2-prompt'
import type { Layer2Input } from './layer2-input'

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

// ── Extraction call ───────────────────────────────────────────────────────────

const MODEL_ID = 'deepseek/deepseek-v4-flash'

/**
 * Call the Layer 2 LLM and return the parsed operations list. Failures
 * (LLM error, schema mismatch) degrade to an empty list — the caller can
 * no-op safely. No retry: the next cron run is always coming.
 */
export async function extractLayer2Operations(
  input: Layer2Input
): Promise<Layer2Operation[]> {
  const { system, user } = buildLayer2Prompt(input)

  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: layer2OutputSchema,
      system,
      prompt: user,
    })
    return object.operations
  } catch (error) {
    console.error(
      `[memory.layer2] extraction failed project=${input.project.id}:`,
      error
    )
    return []
  }
}
