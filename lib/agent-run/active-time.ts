/**
 * Agent ACTIVE time derivation.
 *
 * A task's run-time is the sum, per session, of each completed turn's
 * `(STOP timestamp − that turn's prompt timestamp)`. A turn starts at a
 * `USER_PROMPT_SUBMIT` hook event and ends at the next `STOP` / `STOP_FAILURE`.
 * Summing only completed turns deliberately EXCLUDES the idle gaps between
 * turns (the human reading/typing/away) — unlike a session's wall-clock span
 * (`lastActivityAt − startedAt`), which counts that idle whenever a session
 * stays alive or resumes across a pause.
 *
 * Two known characteristics, both on the safe side (never inflate with idle):
 *  - mid-turn human waits (a permission prompt, an elicitation question) fall
 *    between the prompt and the STOP, so they count as active — a minor
 *    over-count, usually seconds.
 *  - an in-flight turn (a prompt with no STOP yet) is NOT counted until it
 *    STOPs — a minor understatement for a live run, which steps up at each STOP.
 */

const PROMPT = 'USER_PROMPT_SUBMIT'
const STOP_TYPES = new Set(['STOP', 'STOP_FAILURE'])

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
 * ascending. Walks prompt→STOP pairs; ignores everything else; counts only
 * completed turns (anchored to the FIRST prompt of each turn).
 */
export function activeDurationMs(events: SessionTurnEvent[]): number {
  let activeMs = 0
  let lastPrompt: number | null = null
  for (const ev of events) {
    if (ev.type === PROMPT) {
      // Anchor to the first prompt of the turn; ignore extra prompts until a
      // STOP closes it (a turn opened by several queued messages still starts
      // when the human first spoke).
      if (lastPrompt === null) lastPrompt = ms(ev.createdAt)
    } else if (STOP_TYPES.has(ev.type)) {
      if (lastPrompt !== null) {
        activeMs += Math.max(0, ms(ev.createdAt) - lastPrompt)
        lastPrompt = null
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

/**
 * Whole seconds of active time for a flat, possibly-unordered event stream
 * spanning multiple sessions.
 */
export function sumActiveDurationSec(events: TaskTurnEvent[]): number {
  let totalMs = 0
  for (const v of activeDurationMsBySession(events).values()) totalMs += v
  return Math.round(totalMs / 1000)
}
