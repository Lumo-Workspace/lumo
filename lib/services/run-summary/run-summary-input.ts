import {
  compactEvents,
  type RawEvent,
} from '@/lib/services/session-summary/compact-events'

/**
 * LUM-579: build the run-summary LLM input from a session's FULL stored event
 * stream, not the sparse per-turn `turnSummary` field.
 *
 * Why this exists: the old run-summary input (LUM-481) read only the STOP
 * events that happened to carry a `turnSummary`. Those digests are produced by
 * a fire-and-forget `waitUntil` LLM call on the hook route, and in a busy
 * delivery session most are torn down before they complete — so only a sparse,
 * early-biased handful of turns ever get a digest (LUM-471: 3 of 32 turns;
 * LUM-522: 4 of 69). The run-summary then faithfully summarized that fragment
 * and reported "only explored / no code changes" for sessions that in fact
 * delivered and merged — the LUM-572 claim-vs-verification contradiction.
 *
 * The fix sources the run-summary from the same compacted event stream the
 * session-summary pipeline uses (`compactEvents`). Crucially, the per-turn STOP
 * `last_assistant_message` lines bypass the tool-call cap, so even a
 * 1500-event session keeps whole-run narrative coverage — the late delivery
 * turns are represented. This input is robust to the turnSummary coverage gap
 * AND retroactively available for already-completed (frozen) sessions, whose
 * events are all stored.
 *
 * Pure — no I/O — so it is deterministic and unit-testable: the same event
 * stream always yields the same input (the idempotency the regeneration path
 * relies on).
 */

/**
 * Tool-call line budget for the run-summary input. Higher than the
 * session-summary default (150) because the run-summary's one-paragraph output
 * benefits from seeing more of the delivery operations; the STOP narration
 * lines (uncapped) still guarantee tail coverage past this budget.
 */
const MAX_TOOL_CALLS = 200

/**
 * Compact a session's events into the run-summary prompt body, or return null
 * when there is genuinely nothing to summarize (no tool calls and no turn-end
 * narration) — the legitimately-empty case the caller records as skipped, not
 * as a generation failure.
 */
export function buildRunSummaryInput(events: RawEvent[]): string | null {
  if (events.length === 0) return null

  const { text, toolCallLineCount } = compactEvents(events, {
    maxToolCalls: MAX_TOOL_CALLS,
  })
  const trimmed = text.trim()
  if (trimmed.length === 0) return null

  // A turn-end line only carries signal when it quotes the assistant message;
  // bare "[turn end]" markers (no narration) plus zero tool calls = nothing to
  // summarize.
  const hasNarration = trimmed.includes('[turn end] "')
  if (toolCallLineCount === 0 && !hasNarration) return null

  return trimmed
}
