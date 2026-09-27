import { CONTENT_MODEL } from '@/lib/ai/models'
import { generateObject, jsonSchema } from 'ai'
import { gateway } from '@/lib/ai/gateway'
import {
  DEBUG_TOOL,
  EXPLORATION_TOOL,
  IMPLEMENTATION_TOOL,
  MIXED_TOOL,
  REFACTOR_TOOL,
  REVIEW_TOOL,
  type DebugPayload,
  type DebugStatus,
  type ExplorationPayload,
  type ImplementationPayload,
  type MixedPayload,
  type RefactorPayload,
  type ReviewPayload,
  type SessionSummaryPayload,
} from './types'

const CONTENT_MAX_TOKENS = 2048

export type TemplateKind =
  | 'exploration'
  | 'implementation'
  | 'debug'
  | 'refactor'
  | 'review'
  | 'mixed'

interface GenerateArgs {
  kind: TemplateKind
  compactLog: string
  truncatedToolCount: number
  sessionMeta: {
    cwd: string | null
    durationMs: number
    toolCallCount: number
  }
}

const TOOLS = {
  exploration: EXPLORATION_TOOL,
  implementation: IMPLEMENTATION_TOOL,
  debug: DEBUG_TOOL,
  refactor: REFACTOR_TOOL,
  review: REVIEW_TOOL,
  mixed: MIXED_TOOL,
} as const

/**
 * Generate a structured summary via the gateway with a forced object schema
 * (LUM-592). `generateObject` reuses each kind's JSON Schema — the very same
 * shapes that were Anthropic tool `input_schema`s — and returns an
 * already-parsed object; `finalize` then coerces it into the strongly-typed
 * payload. A model that fails to emit a schema-valid object throws
 * `AI_NoObjectGeneratedError`, surfaced to the caller as an upstream error.
 */
export async function generateStructuredSummary(
  args: GenerateArgs
): Promise<SessionSummaryPayload> {
  const tool = TOOLS[args.kind]
  const system = SYSTEM_PROMPTS[args.kind]
  const userPrompt = buildUserPrompt(args)

  const { object } = await generateObject({
    model: gateway(CONTENT_MODEL),
    schema: jsonSchema(tool.input_schema),
    system,
    prompt: userPrompt,
    maxOutputTokens: CONTENT_MAX_TOKENS,
  })

  return finalize(args.kind, object)
}

function finalize(kind: TemplateKind, input: unknown): SessionSummaryPayload {
  switch (kind) {
    case 'exploration':
      return finalizeExploration(input)
    case 'implementation':
      return finalizeImplementation(input)
    case 'debug':
      return finalizeDebug(input)
    case 'refactor':
      return finalizeRefactor(input)
    case 'review':
      return finalizeReview(input)
    case 'mixed':
      return finalizeMixed(input)
  }
}

// ─── System prompts ─────────────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<TemplateKind, string> = {
  exploration: `You are summarizing a Claude Code *exploration* session — the developer was reading code to build understanding, not changing behavior.

You will ALWAYS respond by calling the \`emit_exploration_summary\` tool. Never reply with prose.

Guidance:
- \`whatExplored\` frames the investigation's scope — what system/module/question was the developer trying to understand.
- \`keyFindings\` is the concrete stuff they now know. Prefer findings like "auth middleware expects a cookie named X" over "read auth.ts".
- \`filesExamined\` is the handful of files that actually mattered — up to ~6. Each needs a one-phrase reason.
- \`nextSteps\` captures obvious follow-ups the findings unlock. Empty if the session didn't surface any.`,

  implementation: `You are summarizing a Claude Code *implementation* session — the developer was building new functionality.

You will ALWAYS respond by calling the \`emit_implementation_summary\` tool. Never reply with prose.

Guidance:
- \`goal\` is user-visible ("Add Google OAuth login") — not mechanical ("Edit auth.ts").
- \`accomplished\` lists concrete outcomes only. If nothing shipped cleanly, return an empty array rather than filler text.
- \`keyChanges\` is the handful of files that carry the real change — up to ~6. Use deltas from Edit events when visible.
- \`unresolved\` captures failing tests, explicit "next I'll X" lines, or TODOs the session ended on.
- Infer outcomes from error patterns: \`Bash ... ERR\` is a failure; \`Edit/Write\` with no following ERR is likely success.`,

  debug: `You are summarizing a Claude Code *debug* session — the developer was tracking down and fixing a bug.

You will ALWAYS respond by calling the \`emit_debug_summary\` tool. Never reply with prose.

Guidance:
- \`problem\` is the reported/observed symptom in user-visible terms.
- \`rootCause\` is the actual underlying cause once understood. Null if the session ended before reaching it.
- \`fixApplied\` is the files touched as the fix. Each gets a one-phrase description; include \`delta\` when visible.
- \`verification\` is how the fix was shown to work — tests passed, repro no longer reproduces, etc.
- \`status\`: fixed = confirmed gone; partial = one symptom handled but concerns remain; unresolved = no working fix at session end.
- Repeated Read on the same files + running tests via Bash is a strong debug signal. Bash ERR followed by Edits is a classic fix attempt pattern.`,

  refactor: `You are summarizing a Claude Code *refactor* session — the developer restructured existing code without changing observable behavior.

You will ALWAYS respond by calling the \`emit_refactor_summary\` tool. Never reply with prose.

Guidance:
- \`refactorGoal\` names the structural improvement (e.g. "extract repository layer out of service").
- \`changes\` is up to ~8 structurally meaningful per-file edits. Prefer phrases like "renamed X to Y" or "moved Z into separate file".
- \`scope\` totals: distinct files changed, total lines added, total lines removed. Sum from visible Edit deltas.
- \`behaviorPreservation\` records whether correctness was spot-checked — tests rerun, type-check clean, etc. Null if no such signal appears.
- \`followUps\` captures remaining structural work this refactor enables or still requires.`,

  review: `You are summarizing a Claude Code *review* session — the developer inspected existing code to understand its quality, risks, or readiness. Writes are minimal or absent.

You will ALWAYS respond by calling the \`emit_review_summary\` tool. Never reply with prose.

Guidance:
- \`reviewScope\` is what was under review (module, PR, subsystem, invariant).
- \`findings\` is the concrete flat list of observations.
- \`severity\` triages the findings into critical (blocking), improvements (worth doing), and notes (neutral observations).
- \`recommendations\` is the actionable suggestion list, prioritized when obvious.`,

  mixed: `You are summarizing a Claude Code session that spans multiple activities.

You will ALWAYS respond by calling the \`emit_mixed_summary\` tool. Never reply with prose.

Guidance:
- \`overview\` is one narrative sentence — no lists, no bullet markdown.
- \`mainActivities\` is the rough chronological list of distinct phases.
- \`unresolved\` is anything left pending at session end.`,
}

// ─── Prompt assembly ────────────────────────────────────────────────────────

function buildUserPrompt({
  compactLog,
  truncatedToolCount,
  sessionMeta,
}: GenerateArgs): string {
  const durationText = formatDuration(sessionMeta.durationMs)
  const cwdLine = sessionMeta.cwd
    ? `Working directory: ${sessionMeta.cwd}`
    : 'Working directory: (unknown)'
  const truncationNotice =
    truncatedToolCount > 0
      ? `\n\nNote: ${truncatedToolCount} additional tool calls after the log below were omitted for length.`
      : ''

  return `Session metadata:
${cwdLine}
Duration: ${durationText}
Recorded events: ${sessionMeta.toolCallCount}

Event log:
${compactLog}${truncationNotice}`
}

// ─── Finalize (tool_use.input → strongly-typed payload) ─────────────────────

function finalizeExploration(input: unknown): ExplorationPayload {
  const raw = asRecord(input)
  return {
    type: 'exploration',
    whatExplored: stringOr(raw.whatExplored, ''),
    keyFindings: stringArray(raw.keyFindings),
    filesExamined: fileReasonArray(raw.filesExamined),
    nextSteps: stringArray(raw.nextSteps),
  }
}

function finalizeImplementation(input: unknown): ImplementationPayload {
  const raw = asRecord(input)
  return {
    type: 'implementation',
    goal: stringOr(raw.goal, ''),
    accomplished: stringArray(raw.accomplished),
    keyChanges: changeArray(raw.keyChanges),
    unresolved: stringArray(raw.unresolved),
  }
}

function finalizeDebug(input: unknown): DebugPayload {
  const raw = asRecord(input)
  const status = asDebugStatus(raw.status)
  return {
    type: 'debug',
    problem: stringOr(raw.problem, ''),
    rootCause: nullableString(raw.rootCause),
    fixApplied: changeArray(raw.fixApplied),
    verification: stringArray(raw.verification),
    status,
  }
}

function finalizeRefactor(input: unknown): RefactorPayload {
  const raw = asRecord(input)
  const scopeRaw = asRecord(raw.scope)
  return {
    type: 'refactor',
    refactorGoal: stringOr(raw.refactorGoal, ''),
    changes: simpleChangeArray(raw.changes),
    scope: {
      filesCount: nonNegativeInt(scopeRaw.filesCount),
      linesAdded: nonNegativeInt(scopeRaw.linesAdded),
      linesRemoved: nonNegativeInt(scopeRaw.linesRemoved),
    },
    behaviorPreservation: nullableString(raw.behaviorPreservation),
    followUps: stringArray(raw.followUps),
  }
}

function finalizeReview(input: unknown): ReviewPayload {
  const raw = asRecord(input)
  const severityRaw = asRecord(raw.severity)
  return {
    type: 'review',
    reviewScope: stringOr(raw.reviewScope, ''),
    findings: stringArray(raw.findings),
    severity: {
      critical: stringArray(severityRaw.critical),
      improvements: stringArray(severityRaw.improvements),
      notes: stringArray(severityRaw.notes),
    },
    recommendations: stringArray(raw.recommendations),
  }
}

function finalizeMixed(input: unknown): MixedPayload {
  const raw = asRecord(input)
  return {
    type: 'mixed',
    overview: stringOr(raw.overview, ''),
    mainActivities: stringArray(raw.mainActivities),
    unresolved: stringArray(raw.unresolved),
  }
}

// ─── Small typed helpers ────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function asDebugStatus(v: unknown): DebugStatus {
  return v === 'fixed' || v === 'partial' || v === 'unresolved'
    ? v
    : 'unresolved'
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function nullableString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : []
}

function nonNegativeInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
    ? Math.floor(v)
    : 0
}

function changeArray(
  v: unknown
): Array<{ file: string; delta?: string; description: string }> {
  if (!Array.isArray(v)) return []
  return v.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const rec = item as Record<string, unknown>
    const file = typeof rec.file === 'string' ? rec.file : null
    const description =
      typeof rec.description === 'string' ? rec.description : null
    if (file === null || description === null) return []
    const delta = typeof rec.delta === 'string' ? rec.delta : undefined
    return [{ file, description, ...(delta ? { delta } : {}) }]
  })
}

function simpleChangeArray(
  v: unknown
): Array<{ file: string; description: string }> {
  if (!Array.isArray(v)) return []
  return v.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const rec = item as Record<string, unknown>
    const file = typeof rec.file === 'string' ? rec.file : null
    const description =
      typeof rec.description === 'string' ? rec.description : null
    if (file === null || description === null) return []
    return [{ file, description }]
  })
}

function fileReasonArray(v: unknown): Array<{ file: string; reason: string }> {
  if (!Array.isArray(v)) return []
  return v.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const rec = item as Record<string, unknown>
    const file = typeof rec.file === 'string' ? rec.file : null
    const reason = typeof rec.reason === 'string' ? rec.reason : null
    if (file === null || reason === null) return []
    return [{ file, reason }]
  })
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}min`
}
