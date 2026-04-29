import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { buildLayer3Prompt } from './layer3-prompt'
import type { Layer3Input } from './layer3-input'

const memoryCategorySchema = z.enum([
  'TRAP',
  'DECISION',
  'CONVENTION',
  'PROCEDURAL',
])

/**
 * Layer 3 has only ADD / UPDATE / NOOP. DELETE is intentionally not in the
 * surface — automated removal of project memory is too dangerous; deprecation
 * stays a manual editorial act. Content stays loose (`unknown`) and is
 * re-validated per category at the apply step.
 */
export const layer3OperationSchema = z.discriminatedUnion('type', [
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

export const layer3OutputSchema = z.object({
  operations: z.array(layer3OperationSchema),
})

export type Layer3Operation = z.infer<typeof layer3OperationSchema>
export type Layer3Output = z.infer<typeof layer3OutputSchema>

/**
 * Sonnet, not Haiku: the merge decision is high-stakes (a wrong UPDATE
 * silently corrupts shared project memory), and Layer 3 fires once per task
 * done — so latency is cheap relative to safety. Failures degrade to an
 * empty operations list, which the apply step interprets as "all NOOP" —
 * project memory is never touched on extraction failure.
 */
const MODEL_ID = 'anthropic/claude-sonnet-4-5'

export async function extractLayer3Operations(
  input: Layer3Input
): Promise<Layer3Operation[]> {
  if (input.distilledFacts.length === 0) return []

  const { system, user } = buildLayer3Prompt({
    distilledFacts: input.distilledFacts,
    existingProjectMemories: input.existingProjectMemories,
  })

  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: layer3OutputSchema,
      system,
      prompt: user,
    })
    return object.operations
  } catch (error) {
    console.error(
      `[memory.layer3] extraction failed project=${input.projectId}:`,
      error
    )
    return []
  }
}
