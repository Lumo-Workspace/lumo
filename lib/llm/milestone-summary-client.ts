import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MilestoneSummaryInput {
  subject: string
  window: { start: Date | null; target: Date | null }
  stats: {
    totalTasks: number
    done: number
    inProgress: number
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

export interface MilestoneSummaryOutput {
  tldr: string
  report: string
}

// ── Schema ────────────────────────────────────────────────────────────────────

const MilestoneSummarySchema = z.object({
  tldr: z
    .string()
    .describe('One sentence (≤ 25 words) summarising milestone outcome'),
  report: z
    .string()
    .describe(
      'Markdown retrospective report with sections: ## Summary, ## Delivered, ## Outstanding'
    ),
})

// ── System prompt ─────────────────────────────────────────────────────────────

const MILESTONE_RETRO_SYSTEM_PROMPT = `You are an engineering team assistant writing a milestone retrospective report.

Produce:
- tldr: One sentence (≤ 25 words) capturing the overall milestone outcome.
- report: A Markdown document with EXACTLY these sections in this order:

## Summary
2-3 sentences covering scope, completion rate, and any notable patterns.

## Delivered
Bullet list of completed task titles (use the provided task list).

## Outstanding
1-2 sentences on tasks still open at milestone close and any patterns worth noting. If everything is done, state "Nothing outstanding."

Rules:
- Be factual. Every number must come from the provided stats.
- No preamble, no headings other than the three above, no emoji.`

// ── Client ────────────────────────────────────────────────────────────────────

function buildMilestonePrompt(input: MilestoneSummaryInput): string {
  const { subject, window: win, stats, tasks } = input

  const start = win.start ? win.start.toISOString().slice(0, 10) : '—'
  const target = win.target ? win.target.toISOString().slice(0, 10) : '—'

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

  return `Milestone: ${subject}
Period: ${start} to ${target}

Stats:
  Total tasks: ${stats.totalTasks}
  Done: ${stats.done}
  In progress: ${stats.inProgress}

By Priority:
${priorityLines || '  (none)'}

By Assignee:
${assigneeLines || '  (none)'}

Completed tasks:
${doneLines}`
}

export async function callMilestoneSummaryLLM(
  input: MilestoneSummaryInput
): Promise<MilestoneSummaryOutput> {
  const prompt = buildMilestonePrompt(input)

  const { object } = await generateObject({
    model: gateway('anthropic/claude-sonnet-4.5'),
    schema: MilestoneSummarySchema,
    system: MILESTONE_RETRO_SYSTEM_PROMPT,
    prompt,
  })

  return object
}
