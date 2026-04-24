import Anthropic from '@anthropic-ai/sdk'
import type { SessionMetadata } from './compact-events'
import {
  CLASSIFIER_TOOL,
  SESSION_TYPES,
  type ClassifierOutput,
  type SessionType,
} from './types'

const CLASSIFY_MODEL = 'claude-haiku-4-5-20251001'
const CLASSIFY_MAX_TOKENS = 256

const SYSTEM_PROMPT = `You analyze Claude Code development sessions and classify them into the single type that best describes what the developer was doing.

You will ALWAYS respond by calling the \`classify_session\` tool. Never reply with prose.

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
 * Runs the classifier call. Always returns a {@link ClassifierOutput} — any
 * malformed model reply is normalized to `{ type: 'mixed', confidence: 0 }`
 * so the orchestrator can fall through to the mixed template rather than
 * throwing. Network-level failures still throw.
 */
export async function classifySession(
  client: Anthropic,
  input: ClassifyInput
): Promise<ClassifierOutput> {
  const message = await client.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: CLASSIFY_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [CLASSIFIER_TOOL],
    tool_choice: { type: 'tool', name: CLASSIFIER_TOOL.name },
    messages: [{ role: 'user', content: buildUserPrompt(input) }],
  })

  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === 'tool_use' && b.name === CLASSIFIER_TOOL.name
  )
  if (!toolUse) {
    return { type: 'mixed', confidence: 0 }
  }

  const raw = toolUse.input as { type?: unknown; confidence?: unknown }
  const type =
    typeof raw.type === 'string' && isSessionType(raw.type) ? raw.type : 'mixed'
  const confidence =
    typeof raw.confidence === 'number' &&
    raw.confidence >= 0 &&
    raw.confidence <= 1
      ? raw.confidence
      : 0

  return { type, confidence }
}

function isSessionType(s: string): s is SessionType {
  return (SESSION_TYPES as readonly string[]).includes(s)
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
