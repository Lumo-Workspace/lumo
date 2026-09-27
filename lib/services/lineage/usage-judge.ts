import { FAST_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@/lib/ai/gateway'
import type { LineageFragmentType } from '@prisma/client'
import { isTextConstitutionRedundant } from '@/lib/services/memory/extraction-gate'

const MODEL_ID = FAST_MODEL

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
  /** Combined CLAUDE.md + AGENTS.md text (LUM-539). A used fragment that merely
   * restates a constitution line gets NO marginal-value credit; null skips the
   * check (fail-open). */
  constitution?: string | null
}

/** LUM-539 marginal-value grade for a USED fragment. HIGH = it gave the agent
 * something beyond CLAUDE.md / common sense / already-internalized memory; LOW =
 * used but largely restated what the agent would have done anyway (no credit). */
const VALUE_GRADES = ['HIGH', 'LOW'] as const

const usedEntrySchema = z.object({
  fragmentType: z.enum(FRAGMENT_TYPES),
  fragmentId: z.string(),
  evidence: z.string(),
  /** Default LOW (LUM-589): a weak-schema model (deepseek) that omits the grade
   * earns NO marginal-value credit. The constitution gate only catches CLAUDE.md
   * redundancy — not the "common sense / already-internalized" class of LOW — so
   * a missing grade must fail closed (LOW → dropped by applyMarginalValueGate)
   * rather than silently inflate the trust flywheel with unearned HIGH credit. */
  value: z.enum(VALUE_GRADES).default('LOW'),
})

const unusedEntrySchema = z.object({
  fragmentType: z.enum(FRAGMENT_TYPES),
  fragmentId: z.string(),
  evidence: z.string(),
})

export const usageJudgeSchema = z.object({
  used: z.array(usedEntrySchema),
  unused: z.array(unusedEntrySchema).default([]),
})
export type UsageJudgeOutput = z.infer<typeof usageJudgeSchema>

const SYSTEM_PROMPT = `You audit the MARGINAL VALUE that injected context fragments gave a coding agent.

You are given (1) a list of context fragments injected at the start of the agent's session, each with a stable handle "TYPE::id", and (2) a compacted log of what the agent actually DID (files read/edited, commands run, conclusions).

The question is NOT merely "did the agent do what the fragment says" — it is "did this fragment give the agent something it would NOT already have had from CLAUDE.md / AGENTS.md, common engineering sense, or knowledge any competent agent has internalized". A fragment that only restates a project rule the agent would have followed anyway added no marginal value.

For each fragment that the log shows was actually engaged with, decide it was USED **only** when the log contains concrete evidence that traces to it — e.g. the agent edited a file the fragment names, ran a command the fragment prescribes, or its stated conclusion clearly follows the fragment's content. Quote the specific log evidence. Then grade its marginal value:
- "HIGH": the fragment supplied non-obvious, project-specific knowledge that demonstrably shaped the work (a gotcha, a convention, a decision rationale not visible in code/docs).
- "LOW": the agent did engage it, but it merely restated CLAUDE.md / common sense / something the agent clearly already knew — no marginal value.

Rules, in priority order:
- If there is NO concrete evidence, OMIT the fragment. Do not guess. Abstaining is correct and expected — most reference fragments will be omitted.
- "Looks relevant" or "could have helped" is NOT evidence. Only actions in the log are.
- Never invent evidence. The "evidence" must be a phrase that appears in or directly summarizes the log.
- Output in "used" ONLY fragments you are confident were used, each with concrete evidence AND a "value" grade.
- Output in "unused" ONLY fragments you are confident were NOT engaged with, given the work shown — each with concrete evidence of non-use (e.g. the topic/file it covers was never touched despite related work). If you cannot tell, leave a fragment out of BOTH lists. Absence of mention is not by itself evidence of non-use — require that the log shows substantive related work that would have used the fragment had it been relevant.`

export function buildUsageJudgePrompt(input: JudgeInput): {
  system: string
  user: string
} {
  const fragLines = input.fragments
    .map(
      f =>
        `- ${f.fragmentType}::${f.fragmentId}\n    ${f.content.replace(/\n+/g, ' ').slice(0, 600)}`
    )
    .join('\n')
  const user = `Task: ${input.taskTitle}

## Injected fragments
${fragLines}

## What the agent did (compacted event log)
${input.eventLog}

Return only the fragments with concrete evidence of use, each graded for marginal value.`
  return { system: SYSTEM_PROMPT, user }
}

/**
 * Deterministic marginal-value gate (LUM-539): of the LLM's USED fragments, keep
 * only those that retain marginal-value credit. A fragment loses credit when the
 * judge graded it "LOW" OR its content closely restates a constitution
 * (CLAUDE.md / AGENTS.md) line — "对 CLAUDE.md 冗余不加分". Pure and deterministic
 * so it is testable without the LLM; the constitution check catches redundancy
 * even when a weak-schema model omits the grade.
 */
export function applyMarginalValueGate(
  used: UsageJudgeOutput['used'],
  fragments: JudgeFragment[],
  constitution: string | null | undefined
): UsageJudgeOutput['used'] {
  const contentByHandle = new Map(
    fragments.map(f => [`${f.fragmentType}::${f.fragmentId}`, f.content])
  )
  return used.filter(u => {
    if (u.value === 'LOW') return false
    const content =
      contentByHandle.get(`${u.fragmentType}::${u.fragmentId}`) ?? ''
    if (isTextConstitutionRedundant(content, constitution ?? null)) return false
    return true
  })
}

/**
 * Call the judge. Returns marginal-value-credited used refs and confident-unused
 * refs (with evidence) — empty sets on any model error (best-effort: a failed
 * audit must never throw, the edges simply stay NULL). Statically imports the AI
 * SDK, so callers MUST reach this via dynamic import to avoid the @ai-sdk/gateway
 * jest TransformStream trap.
 */
export async function judgeFragmentUsage(input: JudgeInput): Promise<{
  used: UsageJudgeOutput['used']
  unused: UsageJudgeOutput['unused']
}> {
  if (input.fragments.length === 0) return { used: [], unused: [] }
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
    const usedOffered = object.used.filter(u =>
      offered.has(`${u.fragmentType}::${u.fragmentId}`)
    )
    // Marginal-value gate: LOW-graded / constitution-redundant uses earn no credit.
    const used = applyMarginalValueGate(
      usedOffered,
      input.fragments,
      input.constitution
    )
    const unused = object.unused.filter(u =>
      offered.has(`${u.fragmentType}::${u.fragmentId}`)
    )
    return { used, unused }
  } catch (error) {
    console.error('[lineage.usageJudge] judge failed:', error)
    return { used: [], unused: [] }
  }
}
