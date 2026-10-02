/**
 * Agent ACTIVE time derivation.
 *
 * A task's run-time is the sum, per session, of each completed turn's active
 * time. A turn starts at a `USER_PROMPT_SUBMIT` hook event and ends at the
 * next `STOP` / `STOP_FAILURE`. Summing only completed turns deliberately
 * EXCLUDES the idle gaps between turns (the human reading/typing/away) —
 * unlike a session's wall-clock span (`lastActivityAt − startedAt`), which
 * counts that idle whenever a session stays alive or resumes across a pause.
 *
 * Within a turn, gaps where the agent is waiting on the human are EXCLUDED.
 * Two complementary mechanisms:
 *
 *  1. **Human-wait markers** — when the gap's starting event is one of
 *     `PERMISSION_REQUEST`, `NOTIFICATION`, or `ELICITATION`, the agent is
 *     blocked waiting for a human response; that gap is skipped entirely.
 *
 *  2. **Idle backstop** (`IDLE_THRESHOLD_MS = 5 min`) — any gap exceeding the
 *     threshold is excluded even if no explicit marker precedes it, catching
 *     stalls with no hook event emitted (e.g., a long tool call that never
 *     fires a POST_TOOL_USE before a human intervenes).
 *
 * The full hook-event stream for the session must be supplied (not just
 * USER_PROMPT_SUBMIT / STOP) so the markers are visible.
 *
 * An in-flight turn (a prompt with no STOP yet) is NOT counted until it
 * STOPs — a minor understatement for a live run, which steps up at each STOP.
 */

const PROMPT = 'USER_PROMPT_SUBMIT'
const STOP_TYPES = new Set(['STOP', 'STOP_FAILURE'])

/** Events that mark the START of a gap where the agent is waiting on a human. */
const HUMAN_WAIT_MARKERS = new Set([
  'PERMISSION_REQUEST',
  'NOTIFICATION',
  'ELICITATION',
])

/**
 * Gaps within a turn that exceed this threshold are also excluded even when no
 * explicit human-wait marker precedes them (catches stalls with no marker).
 */
export const IDLE_THRESHOLD_MS = 5 * 60_000 // 5 minutes

export interface SessionTurnEvent {
  type: string
  createdAt: Date | string
}

export interface TaskTurnEvent extends SessionTurnEvent {
  // Nullable to accept raw HookEvent rows (the column is nullable); a null
  // sessionId is bucketed under a sentinel so it never cross-pairs with a
  // real session.
  sessionId: string | null
}

const NO_SESSION = '__none__'

function ms(at: Date | string): number {
  return new Date(at).getTime()
}

/**
 * Active milliseconds for ONE session's hook events, already ordered by time
 * ascending.
 *
 * Algorithm:
 *  - Scan for turns bounded by USER_PROMPT_SUBMIT → STOP/STOP_FAILURE.
 *  - Within each turn, walk consecutive event pairs and sum the gap, EXCLUDING
 *    the gap when (a) the starting event is a human-wait marker, or (b) the
 *    gap exceeds IDLE_THRESHOLD_MS.
 *  - Between-turn gaps are never counted (the turn-boundary walk handles this).
 *  - A trailing open turn (prompt with no STOP) is intentionally not counted.
 *  - The first prompt of a turn anchors it; extra prompts before the STOP are
 *    treated like any other in-turn event.
 */
export function activeDurationMs(events: SessionTurnEvent[]): number {
  // Find turn boundaries: indices of [USER_PROMPT_SUBMIT, STOP/STOP_FAILURE] pairs.
  // We iterate only events within each turn boundary.
  let activeMs = 0
  let turnStart: number | null = null // index into events[]

  for (let i = 0; i < events.length; i++) {
    const ev: SessionTurnEvent | undefined = events[i]
    if (ev === undefined) continue
    if (ev.type === PROMPT) {
      // Anchor to the FIRST prompt; ignore extra queued prompts mid-turn.
      if (turnStart === null) turnStart = i
    } else if (STOP_TYPES.has(ev.type)) {
      if (turnStart !== null) {
        // Walk all consecutive pairs within this turn and sum non-wait gaps.
        const turnEvents = events.slice(turnStart, i + 1)
        for (let j = 0; j < turnEvents.length - 1; j++) {
          const gapStart: SessionTurnEvent | undefined = turnEvents[j]
          const gapEnd: SessionTurnEvent | undefined = turnEvents[j + 1]
          if (gapStart === undefined || gapEnd === undefined) continue
          const gapMs = Math.max(
            0,
            ms(gapEnd.createdAt) - ms(gapStart.createdAt)
          )
          // Exclude human-wait gaps: started by a marker.
          if (HUMAN_WAIT_MARKERS.has(gapStart.type)) {
            continue
          }
          // Idle backstop: exclude gaps exceeding the threshold, EXCEPT for the
          // gap immediately after USER_PROMPT_SUBMIT — that is the model's initial
          // thinking/response time and may legitimately be long without a stall.
          if (gapStart.type !== PROMPT && gapMs > IDLE_THRESHOLD_MS) {
            continue
          }
          activeMs += gapMs
        }
        turnStart = null
      }
    }
  }
  // A trailing open turn (prompt with no STOP) is intentionally not counted.
  return activeMs
}

/**
 * Active milliseconds per session for a flat, possibly-unordered event stream
 * spanning multiple sessions. Groups by `sessionId` and sorts each group by
 * time so a STOP in one session can never close a prompt in another. Keyed by
 * sessionId → active ms (a session with no completed turn maps to 0).
 */
export function activeDurationMsBySession(
  events: TaskTurnEvent[]
): Map<string, number> {
  const bySession = new Map<string, SessionTurnEvent[]>()
  for (const ev of events) {
    const key = ev.sessionId ?? NO_SESSION
    const list = bySession.get(key)
    if (list) list.push(ev)
    else bySession.set(key, [ev])
  }
  const out = new Map<string, number>()
  for (const [sessionId, list] of bySession) {
    const ordered = [...list].sort((a, b) => ms(a.createdAt) - ms(b.createdAt))
    out.set(sessionId, activeDurationMs(ordered))
  }
  return out
}

/** A turn-stream event that may carry the task it is attributed to. */
export interface AttributedTurnEvent extends TaskTurnEvent {
  /** The event's attributed task (`HookEvent.taskId`, falling back to its
   * session's explicit task). `undefined` = not supplied by the caller. */
  taskId?: string | null
}

/**
 * Active milliseconds per (session, task) group — LUM-932: one unattached
 * session's turns can be attributed to different tasks, so per-task time is
 * bucketed by each EVENT's task rather than through a session→task map. An
 * event without a task (`undefined`) takes `fallbackTask(sessionKey)`.
 * Groups are returned in first-seen order.
 */
export function activeDurationMsBySessionTask(
  events: AttributedTurnEvent[],
  fallbackTask: (sessionId: string) => string | null
): Array<{ sessionId: string; taskId: string | null; ms: number }> {
  const groups = new Map<
    string,
    { sessionId: string; taskId: string | null; list: SessionTurnEvent[] }
  >()
  for (const ev of events) {
    const sessionId = ev.sessionId ?? NO_SESSION
    const taskId = ev.taskId !== undefined ? ev.taskId : fallbackTask(sessionId)
    const key = `${sessionId}\u0000${taskId ?? ''}`
    const group = groups.get(key)
    if (group) group.list.push(ev)
    else groups.set(key, { sessionId, taskId, list: [ev] })
  }
  return [...groups.values()].map(({ sessionId, taskId, list }) => ({
    sessionId,
    taskId,
    ms: activeDurationMs(
      [...list].sort((a, b) => ms(a.createdAt) - ms(b.createdAt))
    ),
  }))
}

/**
 * Whole seconds of active time for a flat, possibly-unordered event stream
 * spanning multiple sessions.
 */
export function sumActiveDurationSec(events: TaskTurnEvent[]): number {
  let totalMs = 0
  for (const v of activeDurationMsBySession(events).values()) totalMs += v
  return Math.round(totalMs / 1000)
}
