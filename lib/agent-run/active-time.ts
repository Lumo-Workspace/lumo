import { parseChildSessionId } from '@/lib/session/child-session-id'

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
 *
 * LUM-1237 — subagents. A subagent's events land on its own child session
 * (`<parentSessionId>:<agentId>`), which has no prompts or STOPs: its turns
 * run `SUBAGENT_START` → `SUBAGENT_STOP` (a SendMessage resume fires another
 * pair on the same child). A background subagent keeps working while its
 * parent sits idle between turns, so its time is its own, not a slice of the
 * parent's turns. Time is then unioned per RUN (a root session and its
 * subagents) and task, so a foreground subagent inside a parent turn is not
 * counted twice.
 */

const PROMPT = 'USER_PROMPT_SUBMIT'
const STOP_TYPES: ReadonlySet<string> = new Set(['STOP', 'STOP_FAILURE'])
const SUBAGENT_START = 'SUBAGENT_START'
const SUBAGENT_STOP_TYPES: ReadonlySet<string> = new Set(['SUBAGENT_STOP'])

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

export interface ActiveTimeOptions {
  /** The stream is a subagent child session's: turns are SUBAGENT_START →
   *  SUBAGENT_STOP instead of USER_PROMPT_SUBMIT → STOP. */
  subagent?: boolean
}

/** A counted span, epoch ms `[start, end)`. */
export type ActiveInterval = [number, number]

const NO_SESSION = '__none__'

function ms(at: Date | string): number {
  return new Date(at).getTime()
}

/** True for a subagent's child session id (`<parent>:<agentId>`). */
export function isSubagentSessionId(sessionId: string): boolean {
  return parseChildSessionId(sessionId) !== null
}

/** The run a session belongs to: its root session id (itself for a root). */
export function runKeyOf(sessionId: string): string {
  return parseChildSessionId(sessionId)?.parentSessionId ?? sessionId
}

/**
 * The counted spans of ONE session's hook events, already ordered by time
 * ascending.
 *
 * Algorithm:
 *  - Scan for turns bounded by USER_PROMPT_SUBMIT → STOP/STOP_FAILURE
 *    (a subagent stream: SUBAGENT_START → SUBAGENT_STOP).
 *  - Within each turn, walk consecutive event pairs and keep the gap, EXCLUDING
 *    it when (a) the starting event is a human-wait marker, or (b) the gap
 *    exceeds IDLE_THRESHOLD_MS.
 *  - Between-turn gaps are never counted (the turn-boundary walk handles this).
 *  - A trailing open turn (no closing event yet) is intentionally not counted.
 *  - The first opener of a turn anchors it; extra openers before the close are
 *    treated like any other in-turn event.
 */
export function activeIntervals(
  events: SessionTurnEvent[],
  options: ActiveTimeOptions = {}
): ActiveInterval[] {
  const opener = options.subagent ? SUBAGENT_START : PROMPT
  const closers = options.subagent ? SUBAGENT_STOP_TYPES : STOP_TYPES
  const out: ActiveInterval[] = []
  let turnStart: number | null = null // index into events[]

  for (let i = 0; i < events.length; i++) {
    const ev: SessionTurnEvent | undefined = events[i]
    if (ev === undefined) continue
    if (ev.type === opener) {
      // Anchor to the FIRST opener; ignore extra queued openers mid-turn.
      if (turnStart === null) turnStart = i
    } else if (closers.has(ev.type)) {
      if (turnStart !== null) {
        // Walk all consecutive pairs within this turn and keep non-wait gaps.
        for (let j = turnStart; j < i; j++) {
          const gapStart: SessionTurnEvent | undefined = events[j]
          const gapEnd: SessionTurnEvent | undefined = events[j + 1]
          if (gapStart === undefined || gapEnd === undefined) continue
          const from = ms(gapStart.createdAt)
          const to = ms(gapEnd.createdAt)
          if (to <= from) continue
          // Exclude human-wait gaps: started by a marker.
          if (HUMAN_WAIT_MARKERS.has(gapStart.type)) continue
          // Idle backstop: exclude gaps exceeding the threshold, EXCEPT for the
          // gap right after the turn opener — that is the model's initial
          // thinking/response time and may legitimately be long without a stall.
          if (gapStart.type !== opener && to - from > IDLE_THRESHOLD_MS) {
            continue
          }
          out.push([from, to])
        }
        turnStart = null
      }
    }
  }
  // A trailing open turn is intentionally not counted.
  return out
}

/** Total length of possibly-overlapping spans, each instant counted once. */
export function unionMs(intervals: ActiveInterval[]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let total = 0
  let curStart: number | null = null
  let curEnd = 0
  for (const [from, to] of sorted) {
    if (curStart === null || from > curEnd) {
      if (curStart !== null) total += curEnd - curStart
      curStart = from
      curEnd = to
    } else if (to > curEnd) {
      curEnd = to
    }
  }
  if (curStart !== null) total += curEnd - curStart
  return total
}

/**
 * Active milliseconds for ONE session's hook events, already ordered by time
 * ascending — the sum of {@link activeIntervals} (which never overlap within
 * one session).
 */
export function activeDurationMs(
  events: SessionTurnEvent[],
  options: ActiveTimeOptions = {}
): number {
  let total = 0
  for (const [from, to] of activeIntervals(events, options)) total += to - from
  return total
}

const byTime = (a: SessionTurnEvent, b: SessionTurnEvent) =>
  ms(a.createdAt) - ms(b.createdAt)

/** Counted spans of one session's (unordered) events; a child session id
 *  reads its turns as a subagent's. */
function sessionIntervals(
  sessionId: string,
  list: SessionTurnEvent[]
): ActiveInterval[] {
  return activeIntervals([...list].sort(byTime), {
    subagent: isSubagentSessionId(sessionId),
  })
}

/**
 * Active milliseconds per session for a flat, possibly-unordered event stream
 * spanning multiple sessions. Groups by `sessionId` and sorts each group by
 * time so a STOP in one session can never close a prompt in another. Keyed by
 * sessionId → active ms (a session with no completed turn maps to 0). A
 * subagent child session is timed by its own SUBAGENT_START → SUBAGENT_STOP
 * turns (LUM-1237).
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
    out.set(sessionId, unionMs(sessionIntervals(sessionId, list)))
  }
  return out
}

/** A turn-stream event that may carry the task it is attributed to. */
export interface AttributedTurnEvent extends TaskTurnEvent {
  /** The event's attributed task (`HookEvent.taskId`, falling back to its
   * session's explicit task). `undefined` = not supplied by the caller. */
  taskId?: string | null
}

const noFallback = (): string | null => null

/** Events grouped by (session, task), first-seen order. */
function groupBySessionTask(
  events: AttributedTurnEvent[],
  fallbackTask: (sessionId: string) => string | null
): Array<{
  sessionId: string
  taskId: string | null
  list: SessionTurnEvent[]
}> {
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
  return [...groups.values()]
}

/**
 * Active milliseconds per (session, task) group — LUM-932: one unattached
 * session's turns can be attributed to different tasks, so per-task time is
 * bucketed by each EVENT's task rather than through a session→task map. An
 * event without a task (`undefined`) takes `fallbackTask(sessionKey)`.
 * Groups are returned in first-seen order.
 *
 * A turn whose events span two tasks is not divided between them: each task
 * group times only the turn boundaries it holds. The attribution engine stamps
 * whole turns, so this is rare, and callers apportion per-task seconds over the
 * session's true total, so the totals stay exact either way.
 */
export function activeDurationMsBySessionTask(
  events: AttributedTurnEvent[],
  fallbackTask: (sessionId: string) => string | null
): Array<{ sessionId: string; taskId: string | null; ms: number }> {
  return groupBySessionTask(events, fallbackTask).map(
    ({ sessionId, taskId, list }) => ({
      sessionId,
      taskId,
      ms: unionMs(sessionIntervals(sessionId, list)),
    })
  )
}

/**
 * LUM-1237: active milliseconds per (run, task). A run is a root session plus
 * its subagent child sessions; each session is timed by its own turns (a
 * background subagent works while its parent is idle between turns), then the
 * run's spans on one task are UNIONED, so a foreground subagent running inside
 * a parent turn on the same task is counted once. Different tasks of one run
 * are timed separately. Groups are returned in first-seen order.
 */
export function activeDurationMsByRunTask(
  events: AttributedTurnEvent[],
  fallbackTask: (sessionId: string) => string | null = noFallback
): Array<{ runKey: string; taskId: string | null; ms: number }> {
  const runs = new Map<
    string,
    { runKey: string; taskId: string | null; spans: ActiveInterval[] }
  >()
  for (const { sessionId, taskId, list } of groupBySessionTask(
    events,
    fallbackTask
  )) {
    const runKey = runKeyOf(sessionId)
    const key = `${runKey}\u0000${taskId ?? ''}`
    const run = runs.get(key) ?? { runKey, taskId, spans: [] }
    run.spans.push(...sessionIntervals(sessionId, list))
    runs.set(key, run)
  }
  return [...runs.values()].map(({ runKey, taskId, spans }) => ({
    runKey,
    taskId,
    ms: unionMs(spans),
  }))
}

/**
 * LUM-1280: the active spans per task, grouped the same way as
 * {@link activeDurationMsByRunTask} (each session timed by its own turns,
 * bucketed by each event's attributed task). Spans may overlap across
 * sessions; callers that need a length union them. Events without a task are
 * dropped.
 */
export function activeIntervalsByTask(
  events: AttributedTurnEvent[]
): Map<string, ActiveInterval[]> {
  const out = new Map<string, ActiveInterval[]>()
  for (const { sessionId, taskId, list } of groupBySessionTask(
    events,
    noFallback
  )) {
    if (taskId === null) continue
    const spans = out.get(taskId) ?? []
    spans.push(...sessionIntervals(sessionId, list))
    out.set(taskId, spans)
  }
  return out
}

/**
 * LUM-1237: active milliseconds per run (root session id) — the Σ over the
 * run's tasks of {@link activeDurationMsByRunTask}, so a run total and its
 * per-task split always reconcile.
 */
export function activeDurationMsByRun(
  events: AttributedTurnEvent[],
  fallbackTask: (sessionId: string) => string | null = noFallback
): Map<string, number> {
  const out = new Map<string, number>()
  for (const g of activeDurationMsByRunTask(events, fallbackTask)) {
    out.set(g.runKey, (out.get(g.runKey) ?? 0) + g.ms)
  }
  return out
}

/**
 * Whole seconds of active time for a flat, possibly-unordered event stream
 * spanning multiple sessions — per run and task (LUM-1237), converted to whole
 * seconds a single time.
 */
export function sumActiveDurationSec(
  events: AttributedTurnEvent[],
  fallbackTask: (sessionId: string) => string | null = noFallback
): number {
  let totalMs = 0
  for (const v of activeDurationMsByRun(events, fallbackTask).values())
    totalMs += v
  return Math.round(totalMs / 1000)
}
