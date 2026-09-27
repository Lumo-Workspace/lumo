import { GENERATION_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@/lib/ai/gateway'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CrossingExplainInput {
  /** The verbatim text of the policy rule that fired; null for non-rule crossings. */
  rule: string | null
  /** Human-readable evidence: the matched command / path / pattern. */
  evidence: string
  /** BoundaryCrossingCategory enum value. */
  category: string
  /** BoundaryCrossingSeverity enum value. */
  severity: string
  /** Turn-level intent the agent stated for the turn this crossing belongs to; null when unresolvable. */
  agentContext: string | null
}

// ── Schema ────────────────────────────────────────────────────────────────────

const CrossingExplainSchema = z.object({
  explanation: z
    .string()
    .describe(
      'A 2-3 sentence plain-language explanation of the boundary crossing for a human reviewer'
    ),
})

// ── System prompt ─────────────────────────────────────────────────────────────

const CROSSING_EXPLAIN_SYSTEM_PROMPT = `You are an engineering assistant helping a human reviewer understand a boundary-crossing detection in a code-agent system.

You will be given:
- category: the type of rule that was tripped (e.g. TEST_TAMPERING, PROJECT_RULE_VIOLATION)
- severity: HIGH, MEDIUM, or LOW
- evidence: the specific command, file path, or pattern that triggered the detection
- rule (optional): the verbatim text of the policy rule that fired
- agentContext (optional): the turn-level intent the agent stated for the turn this crossing belongs to

Produce a single "explanation" field covering three points in 2-3 sentences total:
1. What the agent actually did (ground this in "evidence" and "agentContext" if available).
2. Why it matched the rule / category (reference "rule" if present; otherwise reference the category name).
3. A HEDGED, clearly non-binding assessment of whether this looks like a genuine violation or a likely false positive — and why (e.g. "this was an \`echo\` printing the phrase, not an actual execution — likely a false positive"). Always use hedged language ("looks like", "appears to be", "may be") and never assert definitively that a crossing is or is not a violation.

Rules:
- Be factual and conservative. Ground every claim in the inputs.
- Never assert the crossing IS cleared or SAFE — only offer a hedged, advisory read.
- This explanation is ADVISORY ONLY and has no effect on disposition or the DONE gate.
- 2-3 sentences total; no bullet lists, no headings, no emoji.
- Reply in English.`

// ── Client ────────────────────────────────────────────────────────────────────

function buildExplainPrompt(input: CrossingExplainInput): string {
  const parts: string[] = [
    `category: ${input.category}`,
    `severity: ${input.severity}`,
    `evidence: ${input.evidence}`,
  ]
  if (input.rule) {
    parts.push(`rule: ${input.rule}`)
  }
  if (input.agentContext) {
    parts.push(`agentContext: ${input.agentContext}`)
  }
  return parts.join('\n')
}

export async function explainCrossing(
  input: CrossingExplainInput
): Promise<{ explanation: string }> {
  const prompt = buildExplainPrompt(input)

  const { object } = await generateObject({
    model: gateway(GENERATION_MODEL),
    schema: CrossingExplainSchema,
    system: CROSSING_EXPLAIN_SYSTEM_PROMPT,
    prompt,
  })

  return { explanation: object.explanation }
}
