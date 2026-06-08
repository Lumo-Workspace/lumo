import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { buildLayer1Prompt } from './layer1-prompt'
import type { Layer1Input } from './layer1-input'

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

// ── Extraction call ───────────────────────────────────────────────────────────

const MODEL_ID = 'deepseek/deepseek-v4-flash'

/**
 * Call the Layer 1 LLM and return the parsed operations list. Failures
 * (LLM error, schema mismatch) degrade to an empty operations list — the
 * caller can no-op safely instead of writing nothing-but-noise. We don't
 * retry: a stuck call burns latency and the next Stop will produce another
 * chance soon.
 */
export async function extractLayer1Operations(
  input: Layer1Input
): Promise<Layer1Operation[]> {
  const { system, user } = buildLayer1Prompt({
    task: { title: input.task.title, description: input.task.description },
    turnEvents: input.turnEvents,
    existingMemories: input.existingMemories,
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
      `[memory.layer1] extraction failed task=${input.task.id}:`,
      error
    )
    return []
  }
}
