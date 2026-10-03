import { GENERATION_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'
import type { RetroStruggleAggregate } from '@/lib/services/retro-struggle'

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
  /** Cross-task negative-class rollup (LUM-506) — the reopen / extra-PR-cycle
   *  rework signals the all-green title list would erase. */
  struggle: RetroStruggleAggregate
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
      'Markdown retrospective report with sections: ## Summary, ## Delivered, ## Incomplete & Deferred, ## Risks & Rework'
    ),
})

// ── System prompt ─────────────────────────────────────────────────────────────

export const MILESTONE_RETRO_SYSTEM_PROMPT = `You are an engineering team assistant writing a milestone retrospective report.

Your job is to report what actually happened — including where the work was hard. A clean-looking title list that hides rework, reopens, or extra PR cycles is a FAILURE, not a success. Optimistic self-reporting ("all green, nothing to flag") is the single thing this report exists to prevent.

Produce:
- tldr: One sentence (≤ 25 words) capturing the overall milestone outcome — name the friction if there was any, do not round up to "all done".
- report: A Markdown document with EXACTLY these sections in this order:

## Summary
2-3 sentences covering scope, completion rate, and any notable patterns. If significant rework (reopens / extra PR cycles) occurred, say so here — do not bury it.

## Delivered
Group the DELIVERED (DONE) tasks by theme and call out the load-bearing changes — do NOT emit a flat dump of every task title. Use the provided priority to decide what carried weight. Only DONE tasks belong here.

## Incomplete & Deferred
List every task that was NOT delivered (any non-DONE status) at milestone close, each tagged with its status as provenance (e.g. "(IN_PROGRESS)"). Never silently mix these into Delivered or drop them. If everything was delivered, state "All scoped tasks were delivered (N of N)."

## Risks & Rework
THIS SECTION IS MANDATORY AND MUST ALWAYS BE PRESENT. Report the negative-class signals from the provided records: reopens and extra PR cycles. Name the hard tasks. If — and only if — every signal is genuinely zero, you must still state the basis explicitly (e.g. "Across N tasks, 0 reopens and 0 extra PR cycles were recorded"). A bare all-clear phrase with no stated basis is forbidden — the basis sentence is what makes the clean state honest rather than optimistic.

Rules:
- Be factual. Every number must come from the provided stats or records.
- No preamble, no headings other than the four above, no emoji.`

// ── Client ────────────────────────────────────────────────────────────────────

function renderStruggleBlock(struggle: RetroStruggleAggregate): string {
  const hardLines =
    struggle.hardTasks.length > 0
      ? struggle.hardTasks
          .map(
            t =>
              `    - ${t.identifier} "${t.title}": ${t.reopens} reopen(s), ${t.extraPrCycles} extra PR cycle(s)`
          )
          .join('\n')
      : '    (none)'

  // Always-stated basis — spelled out even when every signal is zero, so the
  // renderer can never collapse the section to a bare all-clear.
  const basis = `Basis: across ${struggle.tasksConsidered} task(s), ${struggle.reopens} reopen(s) and ${struggle.extraPrCycles} extra PR cycle(s) were recorded.`

  return `Negative-class signals (from platform records — NEVER omit these):
  Reopens: ${struggle.reopens}
  Extra PR cycles (>1 PR per task): ${struggle.extraPrCycles}
  Tasks carrying a negative signal: ${struggle.tasksWithStruggle} of ${struggle.tasksConsidered}
  Hard tasks:
${hardLines}

${basis}`
}

export function buildMilestonePrompt(input: MilestoneSummaryInput): string {
  const { subject, window: win, stats, tasks, struggle } = input

  const start = win.start ? win.start.toISOString().slice(0, 10) : '—'
  const target = win.target ? win.target.toISOString().slice(0, 10) : '—'

  const doneTasks = tasks.filter(t => t.status === 'DONE')
  const deliveredLines =
    doneTasks.length > 0
      ? doneTasks.map(t => `  - [${t.priority}] ${t.title}`).join('\n')
      : '  (none)'

  const incompleteTasks = tasks.filter(t => t.status !== 'DONE')
  const incompleteLines =
    incompleteTasks.length > 0
      ? incompleteTasks.map(t => `  - [${t.status}] ${t.title}`).join('\n')
      : '  (none — all scoped tasks delivered)'

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

Delivered (DONE) tasks — group by theme, call out the load-bearing ones (priority in brackets):
${deliveredLines}

Incomplete / not delivered at close — list under "Incomplete & Deferred" with the status tag as provenance, NEVER under Delivered:
${incompleteLines}

${renderStruggleBlock(struggle)}`
}

export async function callMilestoneSummaryLLM(
  input: MilestoneSummaryInput
): Promise<MilestoneSummaryOutput> {
  const prompt = buildMilestonePrompt(input)

  const { object } = await generateObject({
    model: gateway(GENERATION_MODEL),
    schema: MilestoneSummarySchema,
    system: MILESTONE_RETRO_SYSTEM_PROMPT,
    prompt,
  })

  return object
}
