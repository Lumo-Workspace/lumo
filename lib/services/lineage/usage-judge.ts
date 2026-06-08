import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import type { LineageFragmentType } from '@prisma/client'

const MODEL_ID = 'anthropic/claude-haiku-4-5'

const FRAGMENT_TYPES = [
  'MEMORY',
  'SLACK_CONTEXT',
  'WEB_LINK',
  'FIGMA',
  'PR',
  'PR_REVIEW_TODO',
  'SESSION',
] as const

export interface JudgeFragment {
  fragmentType: LineageFragmentType
  fragmentId: string
  content: string
}

export interface JudgeInput {
  taskTitle: string
  fragments: JudgeFragment[]
  /** Compacted event log of what the agent actually did this session. */
  eventLog: string
}

export const usageJudgeSchema = z.object({
  used: z.array(
    z.object({
      fragmentType: z.enum(FRAGMENT_TYPES),
      fragmentId: z.string(),
      evidence: z.string(),
    })
  ),
})
export type UsageJudgeOutput = z.infer<typeof usageJudgeSchema>

const SYSTEM_PROMPT = `You audit whether injected context fragments were actually USED by a coding agent.

You are given (1) a list of context fragments injected at the start of the agent's session, each with a stable handle "TYPE::id", and (2) a compacted log of what the agent actually DID (files read/edited, commands run, conclusions).

For each fragment, decide it was USED **only** when the log contains concrete evidence that traces to it — e.g. the agent edited a file the fragment names, ran a command the fragment prescribes, or its stated conclusion clearly follows the fragment's content. Quote the specific log evidence.

Rules, in priority order:
- If there is NO concrete evidence, OMIT the fragment. Do not guess. Abstaining is correct and expected — most reference fragments will be omitted.
- "Looks relevant" or "could have helped" is NOT evidence. Only actions in the log are.
- Never invent evidence. The "evidence" must be a phrase that appears in or directly summarizes the log.
- Output ONLY the fragments you are confident were used. Never output a "not used" verdict.`

export function buildUsageJudgePrompt(input: JudgeInput): {
  system: string
  user: string
} {
  const fragLines = input.fragments
    .map(
      f => `- ${f.fragmentType}::${f.fragmentId}\n    ${f.content.replace(/\n+/g, ' ').slice(0, 600)}`
    )
    .join('\n')
  const user = `Task: ${input.taskTitle}

## Injected fragments
${fragLines}

## What the agent did (compacted event log)
${input.eventLog}

Return only the fragments with concrete evidence of use.`
  return { system: SYSTEM_PROMPT, user }
}

/**
 * Call the judge. Returns confident-used refs (with evidence) only — empty
 * array on any model error (best-effort: a failed audit must never throw, the
 * edges simply stay NULL). Statically imports the AI SDK, so callers MUST reach
 * this via dynamic import to avoid the @ai-sdk/gateway jest TransformStream trap.
 */
export async function judgeFragmentUsage(
  input: JudgeInput
): Promise<UsageJudgeOutput['used']> {
  if (input.fragments.length === 0) return []
  const { system, user } = buildUsageJudgePrompt(input)
  try {
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: usageJudgeSchema,
      system,
      prompt: user,
    })
    // Defend against hallucinated handles: keep only refs that were offered.
    const offered = new Set(
      input.fragments.map(f => `${f.fragmentType}::${f.fragmentId}`)
    )
    return object.used.filter(u =>
      offered.has(`${u.fragmentType}::${u.fragmentId}`)
    )
  } catch (error) {
    console.error('[lineage.usageJudge] judge failed:', error)
    return []
  }
}
