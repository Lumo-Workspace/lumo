import { REASONING_MODEL } from '@/lib/ai/models'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import type {
  RiskReason,
  TaskSummaryStats,
  WorkspaceSummaryStats,
} from '@/types/summary'
import { parseReport } from './parse-report'

// ─── System Prompts ──────────────────────────────────────────────────────────

export const SUMMARY_SYSTEM_PROMPT_EN = `You are a project management analyst writing a briefing for an engineering lead's daily standup.

A rules engine has already assessed the project's risk level. Your job is NOT to re-assess risk — use the pre-computed level and triggered rules as ground truth.

Produce:
- tldr: One sentence (≤ 25 words) capturing the single most important thing the lead needs to know today.
- report: A Markdown document with EXACTLY these two sections, in this order:

## Today's Focus
2–4 bullet points. Each bullet must:
- Start with an imperative verb (Unblock, Review, Reassign, Fix, Ship…)
- Be ≤ 15 words
- Reference a specific person, task, or number from the stats when possible
- Be immediately actionable this week
- Be ordered by priority (first bullet is most urgent)

## Risk
1–2 sentences. State the risk level in plain language and explain it by citing at least ONE specific number from the triggered rules. Do not list all rules — synthesize.

Rules:
- Be factual. Every number you cite must come from the stats or the triggered rules.
- No preamble, no headings other than the two above, no emoji.
- If the project is healthy with no triggered rules, Today's Focus can be lighter ("Keep momentum on X") and Risk says "No blockers detected."`

export const SUMMARY_SYSTEM_PROMPT_ZH = `你是一位项目管理分析师，正在为工程负责人撰写每日站会的简报。

规则引擎已对项目的风险等级做出评估。你的任务**不是**重新评估风险——请将预先计算的等级和触发的规则视为事实依据。

请输出：
- tldr: 一句话（≤ 35 字），概括负责人今天最需要知道的一件事。
- report: 一份 Markdown 报告，必须**严格包含以下两个章节**，按此顺序：

## 今日关注
2–4 条要点，每条必须：
- 以动词开头（解除阻塞 / 审核 / 重新分配 / 修复 / 交付……）
- ≤ 20 字
- 尽量引用具体的人、任务或数字
- 本周可立即行动
- 按优先级排序（第一条最紧急）

## 风险
1–2 句话。用平实的语言说明风险等级，并至少引用触发规则中的一个具体数字来解释，不要罗列所有规则——请综合概括。

规则：
- 坚持事实。你引用的每一个数字都必须来自统计数据或触发的规则。
- 不写前言，不使用上述两个之外的任何小标题，不使用 emoji。
- 如果项目健康无触发规则，"今日关注"可以较轻量（如"继续推进 X"），"风险"写"未发现阻碍"即可。`

// ─── Zod Schema ──────────────────────────────────────────────────────────────

export const SummaryReportSchema = z.object({
  tldr: z.string().describe('One sentence data-driven summary'),
  report: z
    .string()
    .describe("Markdown report with two sections: Today's Focus and Risk"),
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

// ─── Reason formatter ────────────────────────────────────────────────────────

export function formatReasonsForPrompt(
  reasons: RiskReason[],
  locale: string
): string {
  if (reasons.length === 0) {
    return locale.startsWith('zh') ? '(无触发规则)' : '(no triggered rules)'
  }
  return reasons.map(r => `  - [${r.code}] ${r.detail}`).join('\n')
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildRiskAssessmentBlock(
  stats: TaskSummaryStats,
  locale: string
): string {
  return `## Risk Assessment (pre-computed)
Level: ${stats.risk.level}
Score: ${stats.risk.score}
Triggered rules:
${formatReasonsForPrompt(stats.risk.reasons, locale)}`
}

export function buildProjectPrompt(
  stats: TaskSummaryStats,
  ctx: ProjectContext
): string {
  const { projectName, projectDescription, locale } = ctx

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
Subtask Completion Rate: ${stats.subtaskCompletionRate !== null ? `${(stats.subtaskCompletionRate * 100).toFixed(1)}%` : 'N/A'}

Agent Stats: total=${stats.agentStats.total}, completed=${stats.agentStats.completed}, failed=${stats.agentStats.failed}, working=${stats.agentStats.working}
PR Stats: total=${stats.prStats.total}, merged=${stats.prStats.merged}, open=${stats.prStats.open}

${buildRiskAssessmentBlock(stats, locale)}`
}

export function buildWorkspacePrompt(
  stats: WorkspaceSummaryStats,
  ctx: WorkspaceContext
): string {
  const { workspaceName, locale } = ctx

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
        `  ${p.projectName} [${p.risk.level}]: total=${p.totalTasks}, completed=${p.completedTasks}, overdue=${p.overdueTasks}`
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
Subtask Completion Rate: ${stats.subtaskCompletionRate !== null ? `${(stats.subtaskCompletionRate * 100).toFixed(1)}%` : 'N/A'}

Agent Stats: total=${stats.agentStats.total}, completed=${stats.agentStats.completed}, failed=${stats.agentStats.failed}, working=${stats.agentStats.working}
PR Stats: total=${stats.prStats.total}, merged=${stats.prStats.merged}, open=${stats.prStats.open}

## Project Breakdown
${projectBreakdownLines}

${buildRiskAssessmentBlock(stats, locale)}`
}

// ─── Report generators ────────────────────────────────────────────────────────

export async function generateProjectReport(
  stats: TaskSummaryStats,
  ctx: ProjectContext
): Promise<SummaryReport> {
  const systemPrompt = ctx.locale.startsWith('zh')
    ? SUMMARY_SYSTEM_PROMPT_ZH
    : SUMMARY_SYSTEM_PROMPT_EN
  const prompt = buildProjectPrompt(stats, ctx)

  const { object } = await generateObject({
    model: gateway(REASONING_MODEL),
    schema: SummaryReportSchema,
    system: systemPrompt,
    prompt,
  })

  const parsed = parseReport(object.report, ctx.locale)
  if (parsed.todayFocus.length === 0 && !parsed.riskNarrative) {
    logger.warn(
      'generateProjectReport: report did not match two-section format',
      { locale: ctx.locale, projectName: ctx.projectName }
    )
  }

  return object
}

export async function generateWorkspaceReport(
  stats: WorkspaceSummaryStats,
  ctx: WorkspaceContext
): Promise<SummaryReport> {
  const systemPrompt = ctx.locale.startsWith('zh')
    ? SUMMARY_SYSTEM_PROMPT_ZH
    : SUMMARY_SYSTEM_PROMPT_EN
  const prompt = buildWorkspacePrompt(stats, ctx)

  const { object } = await generateObject({
    model: gateway(REASONING_MODEL),
    schema: SummaryReportSchema,
    system: systemPrompt,
    prompt,
  })

  const parsed = parseReport(object.report, ctx.locale)
  if (parsed.todayFocus.length === 0 && !parsed.riskNarrative) {
    logger.warn(
      'generateWorkspaceReport: report did not match two-section format',
      { locale: ctx.locale, workspaceName: ctx.workspaceName }
    )
  }

  return object
}
