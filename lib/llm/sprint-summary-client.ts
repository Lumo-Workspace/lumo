import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SprintSummaryInput {
  subject: string
  window: { start: Date; end: Date }
  stats: {
    totalTasks: number
    done: number
    spillover: number
    byPriority: Record<string, number>
    byAssignee: Record<string, number>
  }
  tasks: Array<{
    id: string
    status: string
    priority: string
    assigneeActorId: string | null
    title: string
  }>
}

export interface SprintSummaryOutput {
  tldr: string
  report: string
}

// ── Schema ────────────────────────────────────────────────────────────────────

const SprintSummarySchema = z.object({
  tldr: z
    .string()
    .describe('One sentence (≤ 25 words) summarising sprint outcome'),
  report: z
    .string()
    .describe(
      'Markdown retrospective report with sections: ## Summary, ## Done, ## Spillover'
    ),
})

// ── System prompt ─────────────────────────────────────────────────────────────

const SPRINT_RETRO_SYSTEM_PROMPT = `You are an engineering team assistant writing a sprint retrospective report.

Produce:
- tldr: One sentence (≤ 25 words) capturing the overall sprint outcome.
- report: A Markdown document with EXACTLY these sections in this order:

## Summary
2-3 sentences covering velocity, completion rate, and any notable patterns.

## Done
Bullet list of completed task titles (use the provided task list).

## Spillover
1-2 sentences on tasks carried over and any patterns worth noting. If there is no spillover, state "No spillover."

Rules:
- Be factual. Every number must come from the provided stats.
- No preamble, no headings other than the three above, no emoji.`

// ── Client ────────────────────────────────────────────────────────────────────

function buildSprintPrompt(input: SprintSummaryInput): string {
  const { subject, window: win, stats, tasks } = input

  const start = win.start.toISOString().slice(0, 10)
  const end = win.end.toISOString().slice(0, 10)

  const doneTasks = tasks.filter(t => t.status === 'DONE')
  const doneLines =
    doneTasks.length > 0
      ? doneTasks.map(t => `  - ${t.title}`).join('\n')
      : '  (none)'

  const priorityLines = Object.entries(stats.byPriority)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')

  const assigneeLines = Object.entries(stats.byAssignee)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')

  return `Sprint: ${subject}
Period: ${start} to ${end}

Stats:
  Total tasks (including spillover): ${stats.totalTasks}
  Done: ${stats.done}
  Spillover (moved to next sprint): ${stats.spillover}

By Priority:
${priorityLines || '  (none)'}

By Assignee:
${assigneeLines || '  (none)'}

Completed tasks:
${doneLines}`
}

export async function callSprintSummaryLLM(
  input: SprintSummaryInput
): Promise<SprintSummaryOutput> {
  const prompt = buildSprintPrompt(input)

  const { object } = await generateObject({
    model: gateway('anthropic/claude-sonnet-4.5'),
    schema: SprintSummarySchema,
    system: SPRINT_RETRO_SYSTEM_PROMPT,
    prompt,
  })

  return object
}
