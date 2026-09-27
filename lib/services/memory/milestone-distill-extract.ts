import { MEMORY_JUDGE_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@/lib/ai/gateway'
import type { MilestoneDistillInput } from './milestone-distill-input'

const memoryCategorySchema = z.enum([
  'TRAP',
  'DECISION',
  'CONVENTION',
  'PROCEDURAL',
])

export const milestoneDistillCandidateSchema = z.object({
  category: memoryCategorySchema,
  content: z.unknown(),
})
export const milestoneDistillCandidatesOutputSchema = z.object({
  candidates: z.array(milestoneDistillCandidateSchema),
})
export type MilestoneDistillCandidate = z.infer<
  typeof milestoneDistillCandidateSchema
>

const SYSTEM_PROMPT = `You are a memory-distillation agent for an engineering project tool.

You read the retrospective (retro) written when a milestone closes, and distil the durable, cross-milestone learnings worth carrying into the NEXT milestone. These become MILESTONE-scope memories, injected at the start of the next milestone's steward (planning/governance) session — so the bar is high: only lessons that would change how the next milestone is planned or run.

You output a JSON list of *candidate* learnings. A later grounding step verifies each against the retro text, and a dedup step drops ones already recorded. Your job is only to surface the durable lessons.

# What belongs at MILESTONE scope

A learning belongs here when it would help whoever plans or stewards the *next* milestone in this project:
- A recurring risk / friction pattern the retro surfaced (rework hotspots, repeated send-backs, chronic under-estimation of a work type).
- A DECISION or scope lesson that constrains how the next milestone should be shaped.
- A PROCEDURAL lesson about sequencing / dependency ordering that bit this milestone.
- A CONVENTION the milestone converged on that the next one should start with.

Do NOT emit:
- Per-task implementation details (those live at TASK scope).
- A restatement of the milestone's task list or raw stats.
- Praise / neutral narration with no forward-looking lesson.

# Categories & content shapes (same four as the rest of the memory system)

- TRAP: { summary?: string, trigger: string, outcome: string, workaround?: string }
- DECISION: { summary?: string, what: string, why: string, alternatives?: string, implications?: string }
- CONVENTION: { summary?: string, rule: string, scope: string }
- PROCEDURAL: { summary?: string, workflow: string, trigger: string, steps?: string[] }

All string fields must be non-empty, readable cold by a teammate who never saw this milestone, and written like a senior engineer's terse note to future-self — plain words, real verbs, no abstract-noun jargon, one point per memory. \`summary\` is a ≤~8-word title, shorter than the headline field.

# Grounding
Every candidate must be backed by the retro text below — do not invent a lesson the retro does not state. A later step discards ungrounded candidates.

# Output
Return { "candidates": [...] }. If the retro contains no durable forward-looking lesson, return { "candidates": [] }.`

/**
 * The exact retro material the extraction reads — also the source the LUM-396
 * grounding gate quotes against, so it must be byte-identical between the two.
 */
export function buildMilestoneDistillSourceText(
  input: MilestoneDistillInput
): string {
  return `Milestone: ${input.milestone.name}

TL;DR: ${input.retro.tldr}

Retrospective report:
${input.retro.report}`
}

function buildExistingSection(
  existing: MilestoneDistillInput['existingMilestoneMemories']
): string {
  if (existing.length === 0) return '  (none)'
  return existing
    .map(m => `  - category=${m.category} content=${JSON.stringify(m.content)}`)
    .join('\n')
}

/**
 * Pass 1: read the retro and emit candidate MILESTONE-scope learnings. Blind to
 * hallucination (the grounding gate handles that), but aware of already-recorded
 * MILESTONE memories so it does not re-surface a duplicate. Failures degrade to
 * [] — this runs on a fire-and-forget close path.
 */
export async function extractMilestoneDistillCandidates(
  input: MilestoneDistillInput
): Promise<MilestoneDistillCandidate[]> {
  const user = `# Retro material
${buildMilestoneDistillSourceText(input)}

# Already-recorded MILESTONE memories (do NOT re-emit these)
${buildExistingSection(input.existingMilestoneMemories)}

# Your output
Return { "candidates": [...] } — durable, forward-looking learnings grounded in the retro above, excluding any already recorded. If none qualify, return { "candidates": [] }.`

  try {
    const { object } = await generateObject({
      model: gateway(MEMORY_JUDGE_MODEL),
      schema: milestoneDistillCandidatesOutputSchema,
      system: SYSTEM_PROMPT,
      prompt: user,
    })
    return object.candidates
  } catch (error) {
    console.error(
      `[memory.milestone-distill] candidate extraction failed milestone=${input.milestone.id}:`,
      error
    )
    return []
  }
}
