/**
 * LUM-758 §4 — 规划步。输入 diff 摘要 + stage A finding 摘要 + 触发原因，
 * 输出这个 PR 值得查的 0–3 个任务：每个任务一段开放文本 objective（具体查
 * 什么）+ 一个封闭类别（给产出定型，见 `HuntTask` 上的注释）。
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
  HUNT_MAX_PLANNED_TASKS,
  PLAN_HUNT_TOKEN_BUDGET,
  type HuntTask,
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

const TaskSchema = z.object({
  objective: z
    .string()
    .min(20)
    .max(400)
    .describe(
      'What to investigate, specific to THIS diff. Name the actual files, symbols or helpers involved. A generic objective like "check the permission logic carefully" is useless — it gives the analyst nothing to start from.'
    ),
  category: z
    .enum(HUNT_CATEGORIES)
    .describe('Which category findings from this task will be filed under.'),
  startingPoints: z
    .array(z.string())
    .max(5)
    .describe('Files or symbols from the diff to begin at. May be empty.'),
})

const Schema = z.object({
  tasks: z
    .array(TaskSchema)
    .max(HUNT_MAX_PLANNED_TASKS)
    .describe(
      'The investigation tasks worth spending budget on for THIS diff. An empty array is a valid and common answer — it means this pull request is not worth hunting.'
    ),
  reason: z.string().max(400),
})

const SYSTEM_PROMPT = `You route a security hunt. Given a pull request's diff summary, you decide which investigation tasks — if any — are worth spending an expensive analysis budget on.

Categories (used only to type each task's output; they need not be exhaustive or evenly spread across a plan):
- idor: an object id from the request reaches a repository/Prisma call with no membership, ownership or workspace check.
- injection: request-derived strings reach $queryRaw*, child_process, eval/new Function, or a filesystem path without parsing or an allow-list.
- ssrf: a request-derived URL or host reaches fetch/redirect without an allow-list.
- prompt_injection: untrusted text reaches an LLM call as instructions, or model output is executed/persisted as trusted.
- race: check-then-act on shared rows without a transaction, row lock or unique constraint.
- logic: a state machine, gate or quota can be skipped by calling entries out of order or with an unexpected role.

For each task, give:
- objective: what to investigate, specific to THIS diff — name the actual files, symbols or helpers involved.
- category: the single category above that the task's findings would be filed under.
- startingPoints: the files or symbols from the diff to begin at (may be empty).

Rules:
1. Propose AT MOST ${HUNT_MAX_PLANNED_TASKS} tasks. Fewer is better.
2. Every task must earn its place with a concrete, diff-specific objective — not a restatement of a category description. If you cannot name a specific file, symbol or helper worth checking, do not propose the task.
3. An EMPTY array is the right answer whenever the diff shows no concrete path from an entry point to a dangerous sink. Most pull requests deserve an empty array. Returning nothing is not a failure.
4. Never propose a task just because the trigger fired — the trigger is deliberately broad, you are the narrow filter.`

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

Which investigation tasks are worth running for this diff?`,
    20_000
  )
}

export async function planHuntTasks(input: PlanClientInput): Promise<{
  tasks: HuntTask[]
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
  // zod 的 .max() 挡住了超额，但没挡住重复任务（同一 category+objective 出现
  // 两次）：去重后再 slice、再编号，否则重复任务会在 orchestrator 里被当成
  // 两个独立任务各跑一遍 pass 1，重试通道再翻一倍，最多把整个 scan 预算烧
  // 在一个任务上。
  const seen = new Set<string>()
  const deduped = object.tasks.filter(t => {
    const key = `${t.category}:${t.objective}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const tasks: HuntTask[] = deduped
    .slice(0, HUNT_MAX_PLANNED_TASKS)
    .map((t, i) => ({ ...t, id: `t${i + 1}` }))
  return {
    tasks,
    reason: object.reason,
    tokens: usage.totalTokens ?? 0,
  }
}
