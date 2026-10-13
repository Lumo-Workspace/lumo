import { GENERATION_MODEL } from '@/lib/ai/models'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'
import type { TaskSummaryStats, WorkspaceSummaryStats } from '@/types/summary'
import { parseReport } from './parse-report'
import {
  summaryLanguageFor,
  type SummaryLanguage,
} from '@/lib/i18n/summary-locale'

// ─── System Prompts ──────────────────────────────────────────────────────────

export const SUMMARY_SYSTEM_PROMPT_EN = `You are a project management analyst writing a briefing for an engineering lead's daily standup.

Produce:
- tldr: One sentence (≤ 25 words) capturing the single most important thing the lead needs to know today.
- report: A Markdown document with EXACTLY one section:

## Today's Focus
2–4 bullet points. Each bullet must:
- Start with an imperative verb (Unblock, Review, Reassign, Fix, Ship…)
- Be ≤ 15 words
- Reference a specific person, task, or number from the stats when possible
- Be immediately actionable this week
- Be ordered by priority (first bullet is most urgent)

Rules:
- Be factual. Every number you cite must come from the stats.
- No preamble, no headings other than the one above, no emoji.
- If nothing is pressing, Today's Focus can be lighter ("Keep momentum on X").`

export const SUMMARY_SYSTEM_PROMPT_ZH = `你是一位项目管理分析师，正在为工程负责人撰写每日站会的简报。

请输出：
- tldr: 一句话（≤ 35 字），概括负责人今天最需要知道的一件事。
- report: 一份 Markdown 报告，必须**严格包含一个章节**：

## 今日关注
2–4 条要点，每条必须：
- 以动词开头（解除阻塞 / 审核 / 重新分配 / 修复 / 交付……）
- ≤ 20 字
- 尽量引用具体的人、任务或数字
- 本周可立即行动
- 按优先级排序（第一条最紧急）

规则：
- 坚持事实。你引用的每一个数字都必须来自统计数据。
- 不写前言，不使用上述之外的任何小标题，不使用 emoji。
- 如果没有紧急事项，"今日关注"可以较轻量（如"继续推进 X"）。`

/** LUM-1121 — Traditional Chinese, worded for Taiwan (zh-TW workspaces). */
export const SUMMARY_SYSTEM_PROMPT_ZH_HANT = `你是一位專案管理分析師，正在為工程主管撰寫每日站立會議的簡報。

請輸出：
- tldr: 一句話（≤ 35 字），概括主管今天最需要知道的一件事。
- report: 一份 Markdown 報告，必須**只包含一個章節**：

## 今日焦點
2–4 個重點，每個重點必須：
- 以動詞開頭（排除阻礙／審查／重新指派／修正／交付……）
- ≤ 20 字
- 盡可能引用具體的成員、任務或數字
- 本週就能著手處理
- 依優先順序排列（第一點最緊急）

原則：
- 全文使用繁體中文（台灣用語）撰寫，不要使用簡體字。
- 以事實為依據。你引用的每一個數字都必須來自統計資料。
- 不寫開場白，不使用上述以外的任何標題，不使用 emoji。
- 如果沒有緊急事項，「今日焦點」可以寫得輕鬆一些（例如「持續推進 X」）。`

// ─── Zod Schema ──────────────────────────────────────────────────────────────

export const SummaryReportSchema = z.object({
  tldr: z.string().describe('One sentence data-driven summary'),
  report: z.string().describe("Markdown report with a Today's Focus section"),
})

export type SummaryReport = z.infer<typeof SummaryReportSchema>

// ─── Context interfaces ───────────────────────────────────────────────────────

interface ProjectContext {
  projectName: string
  projectDescription: string | null
  locale: string
}

interface WorkspaceContext {
  workspaceName: string
  locale: string
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

export function buildProjectPrompt(
  stats: TaskSummaryStats,
  ctx: ProjectContext
): string {
  const { projectName, projectDescription } = ctx

  const statusLines = Object.entries(stats.statusDistribution)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')

  const priorityLines = Object.entries(stats.priorityDistribution)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')

  const workloadLines =
    stats.memberWorkload.length > 0
      ? stats.memberWorkload
          .map(
            m => `  ${m.name}: assigned=${m.assigned}, completed=${m.completed}`
          )
          .join('\n')
      : '  No assignees'

  const trendLines =
    stats.completionTrend.length > 0
      ? stats.completionTrend.map(t => `  ${t.date}: ${t.completed}`).join('\n')
      : '  No data'

  return `## Project: ${projectName}
Description: ${projectDescription ?? 'Not provided'}

## Task Statistics
Total Tasks: ${stats.totalTasks}

Status Distribution:
${statusLines}

Priority Distribution:
${priorityLines}

Overdue Tasks: ${stats.overdueTasks.count}

Member Workload:
${workloadLines}

Completion Trend (last 30 days):
${trendLines}

Average Completion Time: ${stats.avgCompletionTime !== null ? `${stats.avgCompletionTime.toFixed(1)} hours` : 'N/A'}

Agent Stats: total=${stats.agentStats.total}, completed=${stats.agentStats.completed}, failed=${stats.agentStats.failed}, working=${stats.agentStats.working}
PR Stats: total=${stats.prStats.total}, merged=${stats.prStats.merged}, open=${stats.prStats.open}`
}

export function buildWorkspacePrompt(
  stats: WorkspaceSummaryStats,
  ctx: WorkspaceContext
): string {
  const { workspaceName } = ctx

  const statusLines = Object.entries(stats.statusDistribution)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')

  const priorityLines = Object.entries(stats.priorityDistribution)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')

  const workloadLines =
    stats.memberWorkload.length > 0
      ? stats.memberWorkload
          .map(
            m => `  ${m.name}: assigned=${m.assigned}, completed=${m.completed}`
          )
          .join('\n')
      : '  No assignees'

  const trendLines =
    stats.completionTrend.length > 0
      ? stats.completionTrend.map(t => `  ${t.date}: ${t.completed}`).join('\n')
      : '  No data'

  const projectBreakdownLines = stats.projectBreakdown
    .map(
      p =>
        `  ${p.projectName}: total=${p.totalTasks}, completed=${p.completedTasks}, overdue=${p.overdueTasks}`
    )
    .join('\n')

  return `## Workspace: ${workspaceName}

## Aggregate Statistics
Total Tasks: ${stats.totalTasks}

Status Distribution:
${statusLines}

Priority Distribution:
${priorityLines}

Overdue Tasks: ${stats.overdueTasks.count}

Member Workload:
${workloadLines}

Completion Trend (last 30 days):
${trendLines}

Average Completion Time: ${stats.avgCompletionTime !== null ? `${stats.avgCompletionTime.toFixed(1)} hours` : 'N/A'}

Agent Stats: total=${stats.agentStats.total}, completed=${stats.agentStats.completed}, failed=${stats.agentStats.failed}, working=${stats.agentStats.working}
PR Stats: total=${stats.prStats.total}, merged=${stats.prStats.merged}, open=${stats.prStats.open}

## Project Breakdown
${projectBreakdownLines}`
}

// ─── Report generators ────────────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<SummaryLanguage, string> = {
  en: SUMMARY_SYSTEM_PROMPT_EN,
  zh: SUMMARY_SYSTEM_PROMPT_ZH,
  'zh-Hant': SUMMARY_SYSTEM_PROMPT_ZH_HANT,
}

/**
 * LUM-1117: `locale` is the workspace's `defaultLocale`. Summaries exist in
 * English, Simplified and (LUM-1121) Traditional Chinese; every other
 * language falls back to English.
 */
export function summarySystemPrompt(locale: string): string {
  return SYSTEM_PROMPTS[summaryLanguageFor(locale)]
}

export async function generateProjectReport(
  stats: TaskSummaryStats,
  ctx: ProjectContext
): Promise<SummaryReport> {
  const systemPrompt = summarySystemPrompt(ctx.locale)
  const prompt = buildProjectPrompt(stats, ctx)

  const { object } = await generateObject({
    model: gateway(GENERATION_MODEL),
    schema: SummaryReportSchema,
    system: systemPrompt,
    prompt,
  })

  const parsed = parseReport(object.report, ctx.locale)
  if (parsed.todayFocus.length === 0) {
    logger.warn("generateProjectReport: report had no Today's Focus section", {
      locale: ctx.locale,
      projectName: ctx.projectName,
    })
  }

  return object
}

export async function generateWorkspaceReport(
  stats: WorkspaceSummaryStats,
  ctx: WorkspaceContext
): Promise<SummaryReport> {
  const systemPrompt = summarySystemPrompt(ctx.locale)
  const prompt = buildWorkspacePrompt(stats, ctx)

  const { object } = await generateObject({
    model: gateway(GENERATION_MODEL),
    schema: SummaryReportSchema,
    system: systemPrompt,
    prompt,
  })

  const parsed = parseReport(object.report, ctx.locale)
  if (parsed.todayFocus.length === 0) {
    logger.warn(
      "generateWorkspaceReport: report had no Today's Focus section",
      { locale: ctx.locale, workspaceName: ctx.workspaceName }
    )
  }

  return object
}
