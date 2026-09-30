import { GENERATION_MODEL } from '@/lib/ai/models'
import { z } from 'zod'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunSummaryInput {
  taskTitle: string
  /**
   * LUM-579: the session's full compacted event log (tool calls + per-turn
   * end-of-turn assistant narration), built by `buildRunSummaryInput`. Replaces
   * the old sparse `turnSummaries` input, which only saw the handful of turns
   * that happened to receive a per-turn digest and so systematically
   * under-reported delivery work.
   */
  eventLog: string
}

// ── Schema ────────────────────────────────────────────────────────────────────

const RunSummarySchema = z.object({
  summary: z
    .string()
    .describe(
      'A single concise paragraph (2-4 sentences) summarising one coding-agent run'
    ),
})

// ── System prompt ─────────────────────────────────────────────────────────────

const RUN_SUMMARY_SYSTEM_PROMPT = `You are an engineering assistant summarising ONE coding-agent run.

You are given a compacted event log of the run: one line per tool call
(reads, edits, writes, commands, searches) and an end-of-turn line quoting what
the agent told the user at each turn. Base your summary on what the log actually
shows.

Produce:
- summary: A single concise paragraph (2-4 sentences) describing what the run changed, what it fixed, and what it left open.

Rules:
- Be plain and factual. Ground every claim in the log — if the log shows file edits/writes/commands, the run changed code; if it shows only reads/searches, the run only explored. Do NOT under- or over-state the work.
- No preamble, no headings, no bullet lists, no emoji.
- Reply in the same language as the event log.`

// ── Client ────────────────────────────────────────────────────────────────────

function buildRunPrompt(input: RunSummaryInput): string {
  const { taskTitle, eventLog } = input

  return `Task: ${taskTitle}

Event log (chronological):
${eventLog.trim().length > 0 ? eventLog : '(no events)'}`
}

export async function callRunSummaryLLM(
  input: RunSummaryInput
): Promise<string> {
  const prompt = buildRunPrompt(input)

  const { object } = await generateObject({
    model: gateway(GENERATION_MODEL),
    schema: RunSummarySchema,
    system: RUN_SUMMARY_SYSTEM_PROMPT,
    prompt,
  })

  return object.summary
}
