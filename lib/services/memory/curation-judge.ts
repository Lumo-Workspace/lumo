import { MEMORY_JUDGE_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'

const MODEL_ID = MEMORY_JUDGE_MODEL

export interface CurationCandidate {
  /** Memory row id. */
  id: string
  /** Rendered memory text (memoryContentToText output). */
  text: string
}

export interface CurationJudgeInput {
  taskTitle: string
  candidates: CurationCandidate[]
  /** Compacted event log of what the agent actually did this session. */
  eventLog: string
}

const invalidEntrySchema = z.object({
  id: z.string(),
  reason: z.string(),
})

export const curationJudgeSchema = z.object({
  invalid: z.array(invalidEntrySchema).default([]),
})
export type CurationJudgeOutput = z.infer<typeof curationJudgeSchema>

const SYSTEM_PROMPT = `You audit memories a coding agent just recorded during one task session, and flag ONLY the ones that are clearly WRONG so they can be retired.

You are given (1) the task title, (2) a numbered list of memories the agent recorded this session, each with a stable "id", and (3) a compacted log of what the agent actually DID (files read/edited, commands run, conclusions).

Flag a memory as INVALID **only** when it is clearly wrong, given the evidence:
- It directly contradicts what the session log shows actually happened (e.g. it claims a command/approach worked when the log shows it failed, or names a wrong file/symbol the log disproves).
- It is internally self-contradictory or nonsensical.

Rules, in priority order:
- Default to KEEPING. If you are not clearly confident a memory is wrong, OMIT it. Uncertain memories MUST be left out — abstaining is correct and expected; most memories will be kept.
- "Might be incomplete", "could be phrased better", "seems redundant", or "not obviously useful" are NOT grounds to flag. Only clear wrongness is.
- Never invent contradictions. The "reason" must point to specific evidence in the log or an internal contradiction in the memory itself.
- Output in "invalid" ONLY memories you are confident are wrong, each with a concrete reason. When in doubt, leave it out.`

export function buildCurationJudgePrompt(input: CurationJudgeInput): {
  system: string
  user: string
} {
  const memLines = input.candidates
    .map(c => `- id=${c.id}\n    ${c.text.replace(/\n+/g, ' ').slice(0, 600)}`)
    .join('\n')
  const user = `Task: ${input.taskTitle}

## Memories recorded this session
${memLines}

## What the agent did (compacted event log)
${input.eventLog}

Return only the memories you are confident are clearly wrong.`
  return { system: SYSTEM_PROMPT, user }
}

/**
 * Call the curation judge. Returns the ids of memories confidently judged
 * clearly-wrong (with reasons). Empty set on any model error or empty input —
 * best-effort: a failed curation must never throw; nothing is invalidated.
 * Statically imports the AI SDK, so callers MUST reach this via dynamic import
 * to avoid the @ai-sdk/gateway jest TransformStream trap.
 */
export async function judgeMemoryCuration(
  input: CurationJudgeInput
): Promise<CurationJudgeOutput['invalid']> {
  if (input.candidates.length === 0) return []
  const { system, user } = buildCurationJudgePrompt(input)
  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: curationJudgeSchema,
      system,
      prompt: user,
    })
    // Defend against hallucinated ids: keep only ids that were offered.
    const offered = new Set(input.candidates.map(c => c.id))
    return object.invalid.filter(e => offered.has(e.id))
  } catch (error) {
    console.error('[memory.curationJudge] judge failed:', error)
    return []
  }
}
