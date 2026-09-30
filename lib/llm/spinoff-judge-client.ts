import { REASONING_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'
import type {
  SpinoffJudgeInput,
  SpinoffVerdict,
} from '@/lib/boundary-crossing/spinoff-judge'

/**
 * LUM-511 Phase 4 — the LLM judge for whether a `--new-scope` spinoff is
 * laundered rework of its parent. Given the parent's acceptance criteria and the
 * new task's title/description, decide LAUNDERED (the work is already in the
 * parent's contract — it should have been a fix-in-place) vs LEGIT (genuinely
 * separate, out-of-scope work).
 *
 * Audit-only: the caller wraps this best-effort (withTimeout) and falls back to
 * LEGIT on any throw/timeout, so legitimate work is never falsely flagged. DIP:
 * depends on the shared `ai` + `@ai-sdk/gateway` abstraction, never a raw SDK.
 */

const Schema = z.object({
  classification: z
    .enum(['LAUNDERED', 'LEGIT'])
    .describe(
      'LAUNDERED = the new task is rework already covered by a parent acceptance criterion; LEGIT = genuinely separate, out-of-scope work'
    ),
  reasoning: z.string().describe('One sentence justifying the classification.'),
})

const SYSTEM_PROMPT = `You audit whether a newly-created task is laundered rework of its parent task.

A task is LAUNDERED if its scope is already covered by one of the parent's acceptance criteria — the work belongs on the parent and should have been a fix-in-place / re-verify, not a brand-new task. Spinning it off hides a first-attempt failure.

A task is LEGIT if it is genuinely separate, out-of-scope work that the parent's acceptance contract does not cover.

Default to LEGIT when uncertain — only classify LAUNDERED when the new task clearly addresses something a parent criterion already requires.`

function clip(s: string | null, max: number): string {
  if (!s) return '(none)'
  return s.length > max ? `${s.slice(0, max)}\n…[truncated]` : s
}

function buildPrompt(i: SpinoffJudgeInput): string {
  return `Parent task acceptance criteria:
${i.parentCriteria.map(c => `- ${c}`).join('\n')}

New task title: ${i.newTaskTitle}
New task description:
${clip(i.newTaskDescription, 8_000)}

Is the new task LAUNDERED rework of the parent, or LEGIT new work?`
}

export async function judgeSpinoff(
  input: SpinoffJudgeInput
): Promise<SpinoffVerdict> {
  const { object } = await generateObject({
    model: gateway(REASONING_MODEL),
    schema: Schema,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
  })
  return object.classification
}
