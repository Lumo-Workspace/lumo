import { REASONING_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@/lib/ai/gateway'
import type {
  SilentFixJudgeInput,
  SilentFixVerdict,
} from '@/lib/boundary-crossing/silent-fix-judge'

/**
 * LUM-511 Phase 4 — the LLM judge for whether an edit made to an
 * already-submitted task (entered IN_REVIEW, no recorded send-back) is a
 * REAL_FIX of a defect (which should have left a send-back trace) or a COSMETIC
 * change. Audit-only: the caller wraps this best-effort and falls back to
 * COSMETIC on any throw/timeout. DIP: shared `ai` + `@ai-sdk/gateway` only.
 */

const Schema = z.object({
  classification: z
    .enum(['REAL_FIX', 'COSMETIC'])
    .describe(
      'REAL_FIX = fixes a defect in already-submitted work; COSMETIC = rebase / typo / formatting / docs / comment'
    ),
  reasoning: z.string().describe('One sentence justifying the classification.'),
})

const SYSTEM_PROMPT = `You audit an edit an autonomous coding agent made to a task that had already been submitted for acceptance (it entered review) with NO send-back on record.

Decide whether the edit is a REAL_FIX or COSMETIC.

- REAL_FIX = it fixes a real defect in the already-submitted work — behaviour, logic, a bug, a missed requirement. A defect found after submission should have left a send-back trace; a silent fix hides a first-attempt failure.
- COSMETIC = formatting, a rebase/merge, a typo, a comment/doc tweak, or other no-behaviour-change churn.

Default to COSMETIC when uncertain — only REAL_FIX when the edit clearly changes behaviour to correct a defect.`

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…[truncated]` : s
}

function buildPrompt(i: SilentFixJudgeInput): string {
  return `File edited after the task was submitted for acceptance: ${i.filePath}

Edit summary:
${clip(i.editSummary, 8_000)}

Is this a REAL_FIX of a defect, or a COSMETIC change?`
}

export async function judgeSilentFix(
  input: SilentFixJudgeInput
): Promise<SilentFixVerdict> {
  const { object } = await generateObject({
    model: gateway(REASONING_MODEL),
    schema: Schema,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
  })
  return object.classification
}
