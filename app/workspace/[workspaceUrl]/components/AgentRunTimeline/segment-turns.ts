import type {
  AgentRunItem,
  AgentRunHookEventItem,
  AgentRunMemoryItem,
} from '../../types'

/**
 * One segment of a Run, bracketed by STOP / STOP_FAILURE events.
 *
 * A turn owns the hook events that happened up to (and including) its
 * terminating STOP, plus any memories that Layer 1 extraction sedimented
 * from those events. Multiple memories per turn are common when the LLM
 * decides to ADD facts across several categories in one shot.
 *
 * The trailing turn of a run may be unterminated (no STOP yet — session
 * still mid-flight, or hook stream ended early) — exposed as
 * `terminated: false` so the UI can mark it visually.
 */
export interface Turn {
  /** Inclusive start: the first hook event's createdAt, or the STOP time
   *  if the turn opened with no preceding events (degenerate). */
  startTime: string
  /** Inclusive end: the terminating STOP's createdAt, or the last hook
   *  event's createdAt for an unterminated turn. */
  endTime: string
  /** All hook events in this turn, in order. Includes the terminating
   *  STOP / STOP_FAILURE when `terminated` is true. */
  events: AgentRunHookEventItem[]
  /** Memories Layer 1 extracted right after this turn's STOP. Empty for
   *  silent turns (LLM returned NOOP, or extraction failed). */
  memories: AgentRunMemoryItem[]
  /** True if a STOP / STOP_FAILURE closed this turn. */
  terminated: boolean
  /**
   * The model's own summary of what it just did, taken verbatim from the
   * terminating STOP event's `last_assistant_message` payload field.
   * Used as the turn header so every turn (sedimented or silent) has a
   * one-glance "what happened" line. null when:
   *   - turn is unterminated (no STOP yet)
   *   - STOP payload had no last_assistant_message (older Claude Code,
   *     malformed payload, or STOP_FAILURE which uses error fields).
   */
  summary: string | null
  /** Per-turn per-model cost from the terminating STOP; null if unterminated
   *  or no usage captured. */
  cost: { byModel: import('../../types').ModelCost[] } | null
}

/**
 * Walk a Run's chronologically merged items[] (events + memories) and
 * segment them into Turn buckets. Memories arriving after a STOP attach
 * to that most-recent terminated turn — they're the synthesis of the
 * events leading up to it.
 *
 * Orphan memories (memory before any STOP — shouldn't happen given the
 * Layer 1 trigger flow, but possible if data is corrupt) are silently
 * dropped so the timeline stays consistent. Caller can detect this by
 * comparing turn-memory total against original memory count if needed.
 */
export function segmentIntoTurns(items: AgentRunItem[]): Turn[] {
  const turns: Turn[] = []
  let currentEvents: AgentRunHookEventItem[] = []

  for (const item of items) {
    if (item.kind === 'memory') {
      const lastTurn = turns[turns.length - 1]
      if (lastTurn) lastTurn.memories.push(item)
      // else: orphan memory before any STOP — drop silently.
      continue
    }

    // hook event
    currentEvents.push(item)
    if (item.type === 'STOP' || item.type === 'STOP_FAILURE') {
      const first = currentEvents[0] ?? item
      turns.push({
        startTime: first.createdAt,
        endTime: item.createdAt,
        events: currentEvents,
        memories: [],
        terminated: true,
        summary: extractTurnSummary(item),
        cost: item.turnCost ?? null,
      })
      currentEvents = []
    }
  }

  if (currentEvents.length > 0) {
    const first = currentEvents[0]!
    const last = currentEvents[currentEvents.length - 1]!
    turns.push({
      startTime: first.createdAt,
      endTime: last.createdAt,
      events: currentEvents,
      memories: [],
      terminated: false,
      summary: null,
      cost: null,
    })
  }

  return turns
}

/**
 * Pick the best available "what just happened in this turn" line for
 * the header. Priority:
 *   1. Server-side LLM-generated summary (HookEvent.turnSummary) —
 *      always one tight Chinese sentence, written by the
 *      turn-summary service. Preferred when present.
 *   2. First-sentence excerpt of payload.last_assistant_message —
 *      fallback for older rows the summary service hadn't seen yet,
 *      or when generation failed. STOP_FAILURE additionally falls
 *      back to error/message fields.
 *
 * Returns null when no source is usable.
 */
function extractTurnSummary(stopEvent: AgentRunHookEventItem): string | null {
  if (stopEvent.turnSummary && stopEvent.turnSummary.trim().length > 0) {
    return stopEvent.turnSummary.trim()
  }

  const payload = stopEvent.payload
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  const candidates =
    stopEvent.type === 'STOP_FAILURE'
      ? ['error', 'message', 'last_assistant_message']
      : ['last_assistant_message']

  for (const key of candidates) {
    const v = record[key]
    if (typeof v === 'string' && v.trim().length > 0) {
      return condenseToHeadline(v)
    }
  }
  return null
}

const MAX_HEADLINE_CHARS = 120

/**
 * Condense free-form text into one display line. Strategy:
 *   1. Take the first paragraph (split on blank lines).
 *   2. Take the first sentence within that paragraph (split on
 *      Chinese 。！？ or English . ! ? followed by space/end).
 *   3. Cap at MAX_HEADLINE_CHARS chars with an ellipsis.
 *   4. Collapse internal whitespace so it renders on a single line
 *      regardless of original formatting.
 */
function condenseToHeadline(raw: string): string {
  const firstPara = raw.split(/\n\s*\n/, 1)[0] ?? raw
  const firstSentenceMatch = firstPara.match(/^[^。！？.!?\n]+[。！？.!?]?/)
  const sentence = firstSentenceMatch?.[0] ?? firstPara
  const single = sentence.replace(/\s+/g, ' ').trim()
  if (single.length <= MAX_HEADLINE_CHARS) return single
  return single.slice(0, MAX_HEADLINE_CHARS - 1) + '…'
}
