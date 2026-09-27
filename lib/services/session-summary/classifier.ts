import { FAST_MODEL } from '@/lib/ai/models'
import { generateObject, NoObjectGeneratedError } from 'ai'
import { gateway } from '@/lib/ai/gateway'
import { z } from 'zod'
import type { SessionMetadata } from './compact-events'
import { SESSION_TYPES, type ClassifierOutput } from './types'

const CLASSIFY_MODEL = FAST_MODEL
const CLASSIFY_MAX_TOKENS = 256

const classifierSchema = z.object({
  type: z.enum(SESSION_TYPES),
  confidence: z.number().min(0).max(1),
})

const SYSTEM_PROMPT = `You analyze Claude Code development sessions and classify them into the single type that best describes what the developer was doing.

Respond with a JSON object matching the requested schema — a \`type\` and a \`confidence\`. Never reply with prose.

Types:
- exploration: Purely reading/understanding code, no concrete changes
- implementation: Building new features or modules
- debug: Finding and fixing bugs
- refactor: Restructuring existing code without changing behavior
- review: Code review, diagnostic analysis
- mixed: Session spans multiple types roughly equally, or you genuinely can't tell

Signal guide:
- Read/Grep/Glob heavy, no Edit/Write → exploration or review
- Many Write/Edit events, new file paths → implementation
- Repeated Read on same files + Edit + Bash running tests → debug
- Many Edits across files, no new files → refactor
- Mix of Read + Task subagent dispatches, little writing → review
Set confidence < 0.6 when two types are roughly equal — the orchestrator
will fall back to \`mixed\` below that threshold.`

export interface ClassifyInput {
  metadata: SessionMetadata
  sessionStartedAt: Date
}

/**
 * Runs the classifier call through the AI gateway. Returns a
 * {@link ClassifierOutput} — output that cannot be parsed into the schema is
 * normalized to `{ type: 'mixed', confidence: 0 }` so the orchestrator can fall
 * through to the mixed template rather than throwing. Genuine API/network
 * failures still throw so the caller can surface them.
 */
export async function classifySession(
  input: ClassifyInput
): Promise<ClassifierOutput> {
  try {
    const { object } = await generateObject({
      model: gateway(CLASSIFY_MODEL),
      schema: classifierSchema,
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(input),
      maxOutputTokens: CLASSIFY_MAX_TOKENS,
    })
    return object
  } catch (err) {
    // Unparseable / schema-mismatch output → fall back to mixed (matches the
    // original "no tool_use block → mixed" degradation). Re-throw real
    // API/network errors so the orchestrator can convert them to an HTTP error.
    if (NoObjectGeneratedError.isInstance(err)) {
      return { type: 'mixed', confidence: 0 }
    }
    throw err
  }
}

function buildUserPrompt({
  metadata,
  sessionStartedAt,
}: ClassifyInput): string {
  const durationText = formatDuration(metadata.durationMs)
  const distribution = Object.entries(metadata.toolDistribution)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}: ${count}`)
    .join(', ')
  const first = metadata.firstAssistantMessage
    ? `"${metadata.firstAssistantMessage}"`
    : '(none captured)'
  const stops =
    metadata.keyStopMessages.length === 0
      ? '(none)'
      : metadata.keyStopMessages
          .map(s => `  [${s.t}] "${s.message}"`)
          .join('\n')

  return `Session metadata:
- Started: ${sessionStartedAt.toISOString()}
- Duration: ${durationText}
- Tool calls: ${metadata.toolCallCount}
- Tool distribution: ${distribution || '(no tool calls)'}

First assistant message: ${first}

Key assistant statements across the session:
${stops}

Classify this session.`
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}min`
}
