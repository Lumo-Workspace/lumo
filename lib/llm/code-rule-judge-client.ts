/**
 * LLM judge for project code-rule violations (LUM-590).
 *
 * Mirrors lib/llm/run-summary-client.ts: static imports of `ai` and
 * `@ai-sdk/gateway` so this module must be dynamic-imported from service code
 * that is statically imported into task-state.service (jest TransformStream
 * trap). It is imported dynamically from code-pipeline.service which is in turn
 * dynamic-imported from the worker route.
 *
 * Uses REASONING_MODEL (桶1 VERIFIER tier) — code-rule violation classification
 * is a high-value adversarial judgment where a wrong call (false pass) silently
 * ships a policy breach. Conservative by design: the system prompt instructs the
 * model to return ONLY rules clearly violated by ADDED code.
 */

import { REASONING_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@/lib/ai/gateway'

// ── Schema ────────────────────────────────────────────────────────────────────

const CodeRuleJudgeSchema = z.object({
  violations: z
    .array(
      z.object({
        ruleId: z.string().describe('The id of the violated rule'),
        detail: z
          .string()
          .describe(
            'One sentence explaining what in the diff violates the rule'
          ),
      })
    )
    .describe('Rules clearly violated by the added code. Empty if none.'),
})

// ── System prompt ─────────────────────────────────────────────────────────────

const CODE_RULE_JUDGE_SYSTEM_PROMPT = `You are a code review assistant checking a unified diff against a list of project coding rules.

You will be given:
1. A unified diff (only ADDED lines are relevant — lines starting with '+')
2. A list of coding rules with their ids and assertions

Your task: identify which rules are CLEARLY violated by the ADDED code only.
- Be conservative: if it is ambiguous whether a rule is violated, do NOT include it.
- Only consider lines added in the diff (starting with '+'); ignore removed lines ('-') and context lines.
- Return an empty violations array if no rules are clearly violated.
- For each violation, provide a concise one-sentence detail citing the specific added code that breaks the rule.`

// ── Input / output types ─────────────────────────────────────────────────────

export interface CodeRuleJudgeInput {
  assertions: { ruleId: string; assertion: string }[]
  diff: string
}

export interface CodeRuleJudgeResult {
  violations: { ruleId: string; detail: string }[]
}

// ── Client ────────────────────────────────────────────────────────────────────

function buildPrompt(input: CodeRuleJudgeInput): string {
  const rules = input.assertions
    .map(a => `- [${a.ruleId}] ${a.assertion}`)
    .join('\n')

  return `Rules to check:
${rules}

Unified diff:
${input.diff.trim().length > 0 ? input.diff : '(empty diff)'}`
}

export async function judgeCodeRules(
  input: CodeRuleJudgeInput
): Promise<CodeRuleJudgeResult> {
  const prompt = buildPrompt(input)

  const { object } = await generateObject({
    model: gateway(REASONING_MODEL),
    schema: CodeRuleJudgeSchema,
    system: CODE_RULE_JUDGE_SYSTEM_PROMPT,
    prompt,
  })

  return { violations: object.violations }
}
