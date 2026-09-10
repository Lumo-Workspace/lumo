/**
 * LLM client for compiling CLAUDE.md/AGENTS.md rule text into classified
 * PolicyRule records (LUM-590).
 *
 * Static top-level imports of the AI SDK are intentional here — the SERVICE
 * dynamic-imports this entire module (`await import('@/lib/llm/policy-compiler-client')`)
 * so jest.mock() intercepts the dynamic import in tests and the AI SDK never
 * loads in the test environment (avoids the TransformStream jest trap).
 */
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { POLICY_COMPILER_MODEL } from '@/lib/ai/models'

// ── Schema ────────────────────────────────────────────────────────────────────

const RuleSchema = z.object({
  text: z.string(),
  kind: z.enum(['action', 'code']),
  tier: z.enum(['deterministic', 'semantic']),
  mappedCategory: z.string().optional(),
  predicate: z
    .object({
      type: z.enum(['path-glob', 'cmd-substr', 'diff-regex']),
      value: z.string(),
    })
    .optional(),
  assertion: z.string().optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  blocking: z.boolean(),
})

// ── System prompt ─────────────────────────────────────────────────────────────

const COMPILER_SYSTEM_PROMPT = `You classify a project's CLAUDE.md/AGENTS.md rules for an automated boundary detector.

For each concrete rule, output:
- kind: "action" = observable in a shell command / tool event; "code" = observable in the resulting code diff
- tier: "deterministic" = a literal predicate or a built-in maps it exactly; "semantic" = needs judgement
- when deterministic: set mappedCategory to an EXACT built-in category name if one fits, else set a predicate of shape path-glob|cmd-substr|diff-regex
- when semantic: set tier="semantic" with an assertion string
- blocking: true ONLY when mappedCategory is set AND it matches a known built-in category
- severity: HIGH for security/data-loss rules, MEDIUM for process rules, LOW for style rules

Never invent regex you are unsure of — downgrade to semantic instead.
Ignore prose that is not an enforceable rule.
Only classify concrete actionable rules, not explanations or context.`

// ── Client ────────────────────────────────────────────────────────────────────

/**
 * Output cap for the compile call. GLM (LUM-748) is a reasoning model whose
 * thinking tokens count against `maxOutputTokens`; left at the gateway default
 * (4096) the CLAUDE.md compile burned ~3k on reasoning and truncated the JSON
 * mid-array (`finishReason: length` → AI_NoObjectGeneratedError). A full
 * ~9.5k-char CLAUDE.md measured up to ~7.3k reasoning + ~3.6k text tokens on
 * GLM-5.3 (~1k + ~3k on the shipped GLM-5.2), so 16k leaves headroom without
 * being unbounded.
 */
const COMPILER_MAX_OUTPUT_TOKENS = 16_384

export async function classifyRules(input: {
  sourceText: string
  builtinCategories: string[]
}): Promise<{ rules: z.infer<typeof RuleSchema>[] }> {
  const { object } = await generateObject({
    model: gateway(POLICY_COMPILER_MODEL),
    schema: z.object({ rules: z.array(RuleSchema) }),
    system: COMPILER_SYSTEM_PROMPT,
    prompt: `Built-in categories: ${input.builtinCategories.join(', ')}\n\nRules file:\n${input.sourceText}`,
    maxOutputTokens: COMPILER_MAX_OUTPUT_TOKENS,
  })
  return object
}
