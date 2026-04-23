/**
 * System + user prompt construction for session summaries. Pure, no I/O.
 *
 * The system prompt is frozen so the call shape is stable — even though we
 * don't use prompt caching here (one summary per session, no prefix reuse),
 * keeping it static means two regenerations for the same session diverge
 * only because of model non-determinism, not prompt drift.
 */

export const SYSTEM_PROMPT = `You are summarizing a Claude Code coding session for an engineer who wants to understand what just happened without reading the full event log.

You'll receive a compact log of every tool call the agent made (Read, Edit, Bash, etc.) and the assistant's final statements. Tool inputs and outputs are already heavily abridged — focus on intent and outcome, not transcription.

Produce a summary in this exact Markdown structure:

## What was accomplished
(1-3 short bullet points. Describe user-visible outcomes in plain language — "Added Google OAuth login", not "Edited auth.ts and authRoute.ts". Skip this section if nothing concrete shipped.)

## Key changes
(Bullet list of files modified, each with one brief reason. Format: \`- path/to/file.ts — what changed and why\`. Skip if no files were changed.)

## Unresolved
(Anything the session ended on without finishing: failing tests, errors left unfixed, half-done refactors, explicit "I'll do X next" statements. Skip this section if everything completed cleanly.)

Rules:
- Under 200 words total.
- Omit any section that doesn't apply — don't write "N/A" or "nothing".
- Write for an engineer briefing their teammate. No preamble, no "Here is the summary".
- Infer outcomes from error patterns: Bash ERR means a failure; Edit/Write with no subsequent error means a likely success.
- If the log is dominated by exploration (Read/Grep/Glob with no writes), say that explicitly under "What was accomplished" — the engineer spent the session investigating, not shipping.`

export interface SessionContext {
  cwd: string | null
  startedAt: Date
  lastActivityAt: Date
  eventCount: number
}

export function buildUserPrompt(
  session: SessionContext,
  compactLog: string,
  truncatedToolCount: number
): string {
  const durationMs =
    session.lastActivityAt.getTime() - session.startedAt.getTime()
  const durationText = formatDurationForPrompt(durationMs)
  const cwdLine = session.cwd
    ? `Working directory: ${session.cwd}`
    : 'Working directory: (unknown)'

  const truncationNotice =
    truncatedToolCount > 0
      ? `\n\nNote: ${truncatedToolCount} additional tool calls after the log below were omitted for length.`
      : ''

  return `Session metadata:
${cwdLine}
Duration: ${durationText}
Recorded events: ${session.eventCount}

Event log:
${compactLog}${truncationNotice}`
}

function formatDurationForPrompt(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}min`
}
