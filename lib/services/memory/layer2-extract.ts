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
 * - NOOP signals "nothing new to consolidate this run".
 *
 * No DELETE: Layer 2 only adds and refines. Retracting a PROJECT memory is
 * deferred — it should come from a user action or a future contradiction
 * pass, not from a periodic consolidation job.
 */
export const layer2OperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ADD'),
    category: memoryCategorySchema,
    content: z.unknown(),
  }),
  z.object({
    type: z.literal('UPDATE'),
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

const MODEL_ID = 'anthropic/claude-haiku-4-5'

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
