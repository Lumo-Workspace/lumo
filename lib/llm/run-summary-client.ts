import { z } from 'zod'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunSummaryInput {
  taskTitle: string
  turnSummaries: string[]
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

Produce:
- summary: A single concise paragraph (2-4 sentences) describing what the run changed, what it fixed, and what it left open.

Rules:
- Be plain and factual. No preamble, no headings, no bullet lists, no emoji.
- Reply in the same language as the turn notes.`

// ── Client ────────────────────────────────────────────────────────────────────

function buildRunPrompt(input: RunSummaryInput): string {
  const { taskTitle, turnSummaries } = input

  const turnLines =
    turnSummaries.length > 0
      ? turnSummaries.map((note, i) => `${i + 1}. ${note}`).join('\n')
      : '(no turn notes)'

  return `Task: ${taskTitle}

Turn-by-turn notes:
${turnLines}`
}

export async function callRunSummaryLLM(
  input: RunSummaryInput
): Promise<string> {
  const prompt = buildRunPrompt(input)

  const { object } = await generateObject({
    model: gateway('anthropic/claude-sonnet-4.5'),
    schema: RunSummarySchema,
    system: RUN_SUMMARY_SYSTEM_PROMPT,
    prompt,
  })

  return object.summary
}
