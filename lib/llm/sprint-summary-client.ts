import { GENERATION_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'
import type { RetroStruggleAggregate } from '@/lib/services/retro-struggle'

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
  /** Cross-task negative-class rollup (LUM-506) — the rework / send-back /
   *  reopen / human-override signals the all-green title list would erase. */
  struggle: RetroStruggleAggregate
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
      'Markdown retrospective report with sections: ## Summary, ## Done, ## Spillover, ## Risks & Rework'
    ),
})

// ── System prompt ─────────────────────────────────────────────────────────────

export const SPRINT_RETRO_SYSTEM_PROMPT = `You are an engineering team assistant writing a sprint retrospective report.

Your job is to report what actually happened — including where the work was hard. A clean-looking title list that hides rework, send-backs, reopens, or human overrides is a FAILURE, not a success. Optimistic self-reporting ("all green, nothing to flag") is the single thing this report exists to prevent.

Produce:
- tldr: One sentence (≤ 25 words) capturing the overall sprint outcome — name the friction if there was any, do not round up to "all done".
- report: A Markdown document with EXACTLY these sections in this order:

## Summary
2-3 sentences covering velocity, completion rate, and any notable patterns. If significant rework/send-backs/overrides occurred, say so here — do not bury it.

## Done
Group the completed (DONE) tasks by theme and call out the load-bearing changes — do NOT emit a flat dump of every task title. Use the provided priority to decide what carried weight. Only DONE tasks belong here.

## Spillover
List every task that did NOT complete (any non-DONE status) and carried over, each tagged with its status as provenance (e.g. "(IN_PROGRESS)"). Never silently mix these into Done or drop them. If nothing carried over, state the basis explicitly (e.g. "All N tasks completed; 0 carried over.") — do not emit a bare all-clear.

## Risks & Rework
THIS SECTION IS MANDATORY AND MUST ALWAYS BE PRESENT. Report the negative-class signals from the provided verification records: rework rounds, FAIL verdicts, open vs resolved send-backs, reopens, leftover follow-ups, extra PR cycles, and machine-verified vs human-overridden criteria. Name the hard tasks. If — and only if — every signal is genuinely zero, you must still state the basis explicitly (e.g. "Across N tasks and M verification rounds, 0 FAIL, 0 send-backs, 0 reopens, and 0 human overrides were recorded"). A bare all-clear phrase with no stated basis is forbidden — the basis sentence is what makes the clean state honest rather than optimistic.

Rules:
- Be factual. Every number must come from the provided stats or verification records.
- No preamble, no headings other than the four above, no emoji.`

// ── Client ────────────────────────────────────────────────────────────────────

function renderStruggleBlock(struggle: RetroStruggleAggregate): string {
  const hardLines =
    struggle.hardTasks.length > 0
      ? struggle.hardTasks
          .map(
            t =>
              `    - ${t.identifier} "${t.title}": ${t.reworkRounds} rework round(s), ${t.openSendBacks} open send-back(s), ${t.reopens} reopen(s), ${t.extraPrCycles} extra PR cycle(s), ${t.humanOverridden} human override(s)`
          )
          .join('\n')
      : '    (none)'

  // Always-stated basis — spelled out even when every signal is zero, so the
  // renderer can never collapse the section to a bare all-clear.
  const basis = `Verification basis: across ${struggle.tasksConsidered} task(s), ${struggle.reworkRounds} rework round(s) / ${struggle.failedVerdicts} FAIL verdict(s), ${
    struggle.openSendBacks + struggle.resolvedSendBacks
  } send-back(s) (${struggle.openSendBacks} still open), ${struggle.reopens} reopen(s), and ${struggle.humanOverridden} human override(s) were recorded.`

  return `Negative-class signals (from platform verification records — NEVER omit these):
  Rework rounds (rounds with ≥1 FAIL): ${struggle.reworkRounds}
  Failed verdicts: ${struggle.failedVerdicts}
  Open send-backs: ${struggle.openSendBacks}   Resolved send-backs: ${struggle.resolvedSendBacks}
  Reopens: ${struggle.reopens}
  Leftover follow-ups: ${struggle.followUps}
  Extra PR cycles (>1 PR per task): ${struggle.extraPrCycles}
  Machine-verified criteria: ${struggle.machineVerified} of ${struggle.machineTotal}   Human-overridden: ${struggle.humanOverridden}
  Tasks carrying a negative signal: ${struggle.tasksWithStruggle} of ${struggle.tasksConsidered}
  Hard tasks:
${hardLines}

${basis}`
}

export function buildSprintPrompt(input: SprintSummaryInput): string {
  const { subject, window: win, stats, tasks, struggle } = input

  const start = win.start.toISOString().slice(0, 10)
  const end = win.end.toISOString().slice(0, 10)

  const doneTasks = tasks.filter(t => t.status === 'DONE')
  const doneLines =
    doneTasks.length > 0
      ? doneTasks.map(t => `  - [${t.priority}] ${t.title}`).join('\n')
      : '  (none)'

  const spilloverTasks = tasks.filter(t => t.status !== 'DONE')
  const spilloverLines =
    spilloverTasks.length > 0
      ? spilloverTasks.map(t => `  - [${t.status}] ${t.title}`).join('\n')
      : '  (none — all sprint tasks completed)'

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

Done tasks — group by theme, call out the load-bearing ones (priority in brackets):
${doneLines}

Spillover / not completed — list under "Spillover" with the status tag as provenance, NEVER under Done:
${spilloverLines}

${renderStruggleBlock(struggle)}`
}

export async function callSprintSummaryLLM(
  input: SprintSummaryInput
): Promise<SprintSummaryOutput> {
  const prompt = buildSprintPrompt(input)

  const { object } = await generateObject({
    model: gateway(GENERATION_MODEL),
    schema: SprintSummarySchema,
    system: SPRINT_RETRO_SYSTEM_PROMPT,
    prompt,
  })

  return object
}
