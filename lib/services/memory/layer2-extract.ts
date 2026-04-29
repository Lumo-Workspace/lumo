import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { buildLayer2Prompt } from './layer2-prompt'
import type { Layer2Input } from './layer2-input'

const memoryCategorySchema = z.enum([
  'TRAP',
  'DECISION',
  'CONVENTION',
  'PROCEDURAL',
])

/**
 * The LLM is loose on `content` — re-validated per-category by
 * `parseMemoryContent` at the apply step (Layer 3 input). Same loose-then-
 * strict pattern as Layer 1 so a single shape error doesn't reject the batch.
 */
export const layer2FactSchema = z.object({
  category: memoryCategorySchema,
  content: z.unknown(),
})

export const layer2OutputSchema = z.object({
  facts: z.array(layer2FactSchema),
})

export type Layer2Fact = z.infer<typeof layer2FactSchema>
export type Layer2Output = z.infer<typeof layer2OutputSchema>

const MODEL_ID = 'anthropic/claude-sonnet-4-5'

/**
 * Call the Layer 2 LLM and return the distilled facts list. Failures
 * (LLM error, schema mismatch) degrade to an empty list — caller treats
 * "no facts to promote" as a normal terminal state.
 *
 * Uses Sonnet rather than Haiku: distillation requires more nuanced
 * judgement ("does this generalize?") than the per-turn extraction Layer 1
 * does, and Layer 2 fires once per task done — not per stop — so latency is
 * less precious here.
 */
export async function extractLayer2Facts(
  input: Layer2Input
): Promise<Layer2Fact[]> {
  const { system, user } = buildLayer2Prompt({
    task: { title: input.task.title, description: input.task.description },
    taskMemories: input.taskMemories,
  })

  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: layer2OutputSchema,
      system,
      prompt: user,
    })
    return object.facts
  } catch (error) {
    console.error(
      `[memory.layer2] extraction failed task=${input.task.id}:`,
      error
    )
    return []
  }
}
