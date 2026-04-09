import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import type { TaskSummaryStats, WorkspaceSummaryStats } from '@/types/summary'

// ─── System Prompts ──────────────────────────────────────────────────────────

export const SUMMARY_SYSTEM_PROMPT_EN = `You are a project management analyst. Given task statistics for a project or workspace, produce a concise, data-driven summary.

Your response must include:
- tldr: A single sentence capturing the most important insight from the data.
- report: A Markdown report with exactly 3 sections:
  ## Progress Overview
  Summarize completion rate, task distribution, and trends.
  ## Risks & Blockers
  Highlight overdue tasks, failing agents, stalled work.
  ## Suggested Actions
  Provide 2–3 concrete, prioritized recommendations based on the data.

Be factual. Reference specific numbers from the statistics. Do not fabricate data.`

export const SUMMARY_SYSTEM_PROMPT_ZH = `你是一位项目管理分析师。根据项目或工作区的任务统计数据，生成简洁、数据驱动的摘要报告。

你的回复必须包含：
- tldr: 一句话，总结数据中最重要的洞察。
- report: 一份 Markdown 报告，包含以下 3 个章节（使用中文标题）：
  ## 进展概览
  总结完成率、任务分布和趋势。
  ## 风险与阻碍
  指出逾期任务、失败的 Agent、停滞的工作。
  ## 建议行动
  根据数据提供 2–3 条具体、有优先级的建议。

请基于数据事实作答，引用统计数据中的具体数字，不得捏造数据。`

// ─── Zod Schema ──────────────────────────────────────────────────────────────

export const SummaryReportSchema = z.object({
  tldr: z.string().describe('One sentence data-driven summary'),
  report: z
    .string()
    .describe(
      'Markdown report with sections: Progress Overview, Risks & Blockers, Suggested Actions'
    ),
})

export type SummaryReport = z.infer<typeof SummaryReportSchema>

// ─── Context interfaces ───────────────────────────────────────────────────────

interface ProjectContext {
  projectName: string
  projectDescription: string | null
  locale: string // "en" or "zh"
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

  const breakdownLines = 'projectBreakdown' in stats ? '' : ''

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
${breakdownLines}`
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
Subtask Completion Rate: ${stats.subtaskCompletionRate !== null ? `${(stats.subtaskCompletionRate * 100).toFixed(1)}%` : 'N/A'}

Agent Stats: total=${stats.agentStats.total}, completed=${stats.agentStats.completed}, failed=${stats.agentStats.failed}, working=${stats.agentStats.working}
PR Stats: total=${stats.prStats.total}, merged=${stats.prStats.merged}, open=${stats.prStats.open}

## Project Breakdown
${projectBreakdownLines}`
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
    model: gateway('anthropic/claude-sonnet-4.5'),
    schema: SummaryReportSchema,
    system: systemPrompt,
    prompt,
  })

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
    model: gateway('anthropic/claude-sonnet-4.5'),
    schema: SummaryReportSchema,
    system: systemPrompt,
    prompt,
  })

  return object
}
