/**
 * LUM-758 §4 — 规划步。输入 diff 摘要 + stage A finding 摘要 + 触发原因，
 * 输出这个 PR 值得查的 0–2 个类别。
 *
 * FAST 桶、无工具、一次结构化输出：这是**路由决策**，不是分析。对抗性判断
 * 属于 falsifier（`security-falsifier-client.ts`），本步不做任何判定。
 *
 * 静态 import 了 `ai` / `@ai-sdk/gateway`：本模块只能经 service 的
 * `await import()` 到达（jest TransformStream 陷阱）。
 */
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { z } from 'zod'
import { FAST_MODEL } from '@/lib/ai/models'
import {
  HUNT_CATEGORIES,
  HUNT_MAX_PLANNED_CATEGORIES,
  PLAN_HUNT_TOKEN_BUDGET,
  type HuntCategory,
} from '@/lib/services/security-hunt.config'
import type { FindingSummary } from '@/lib/repositories/pr-security-scan.repository'

export interface PlanClientInput {
  /** 触发原因（`diff:sink:prisma-raw` 等）。 */
  reasons: string[]
  /** PR 改到的文件，带是否 touched。 */
  files: Array<{ path: string; touched: boolean }>
  /** 子图里的 entry / sink / control 符号，按 `id (file:line, rule)` 渲染。 */
  signals: string[]
  /** stage A 已经报出来的 finding 摘要。 */
  findings: FindingSummary[]
  timeoutMs: number
}

const Schema = z.object({
  categories: z
    .array(z.enum(HUNT_CATEGORIES))
    .max(HUNT_MAX_PLANNED_CATEGORIES)
    .describe(
      'The categories worth hunting for THIS diff. An empty array is a valid and common answer — it means this PR is not worth hunting.'
    ),
  reason: z
    .string()
    .max(400)
    .describe('One sentence naming the diff evidence that drove the choice.'),
})

const SYSTEM_PROMPT = `You route a security hunt. Given a pull request's diff summary, you decide which vulnerability categories — if any — are worth spending an expensive analysis budget on.

Categories:
- idor: an object id from the request reaches a repository/Prisma call with no membership, ownership or workspace check.
- injection: request-derived strings reach $queryRaw*, child_process, eval/new Function, or a filesystem path without parsing or an allow-list.
- ssrf: a request-derived URL or host reaches fetch/redirect without an allow-list.
- prompt_injection: untrusted text reaches an LLM call as instructions, or model output is executed/persisted as trusted.
- race: check-then-act on shared rows without a transaction, row lock or unique constraint.
- logic: a state machine, gate or quota can be skipped by calling entries out of order or with an unexpected role.

Rules:
1. Pick AT MOST ${HUNT_MAX_PLANNED_CATEGORIES}. Fewer is better.
2. An EMPTY array is the right answer whenever the diff shows no concrete path from an entry point to a dangerous sink. Most pull requests deserve an empty array. Returning nothing is not a failure.
3. Choose only categories the diff evidence actually supports. Do not pick a category because it is generally important.
4. Never pick a category just because the trigger fired — the trigger is deliberately broad, you are the narrow filter.`

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text
}

function buildPrompt(i: PlanClientInput): string {
  const files = i.files
    .map(f => `- ${f.path}${f.touched ? ' (touched by the PR)' : ''}`)
    .join('\n')
  const findings =
    i.findings.length === 0
      ? '(none)'
      : i.findings
          .map(f => `- [${f.severity}] ${f.ruleId}: ${f.title}`)
          .join('\n')
  return clip(
    `## Trigger reasons
${i.reasons.map(r => `- ${r}`).join('\n') || '(none)'}

## Files in the diff subgraph
${files || '(none)'}

## Entry / sink / control signals
${i.signals.map(s => `- ${s}`).join('\n') || '(none)'}

## Stage A findings already reported
${findings}

Which categories are worth hunting for this diff?`,
    20_000
  )
}

export async function planHuntCategories(input: PlanClientInput): Promise<{
  categories: HuntCategory[]
  reason: string
  tokens: number
}> {
  const { object, usage } = await generateObject({
    model: gateway(FAST_MODEL),
    schema: Schema,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    maxOutputTokens: PLAN_HUNT_TOKEN_BUDGET,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(input.timeoutMs),
  })
  // zod 的 .max() 已经挡住超额，这里 slice 是对「schema 被放宽」的第二道闸。
  return {
    categories: object.categories.slice(0, HUNT_MAX_PLANNED_CATEGORIES),
    reason: object.reason,
    tokens: usage.totalTokens ?? 0,
  }
}
