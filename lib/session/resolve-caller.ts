/**
 * LUM-932: identify which session in a parent+children family issued a `lumo`
 * CLI call. Claude Code runs the PreToolUse hook synchronously before the Bash
 * command, so the calling subagent's own PreToolUse row is already recorded
 * and still pending (no POST yet) when the CLI asks. We match the CLI's argv
 * against pending Bash commands that run `lumo`. Pure + deterministic.
 */
export interface ToolEventRow {
  sessionId: string
  type: 'PRE_TOOL_USE' | 'POST_TOOL_USE' | 'POST_TOOL_USE_FAILURE'
  createdAt: Date
  payload: unknown
}

export type CallerMatch =
  | { kind: 'none' }
  | { kind: 'one'; sessionId: string }
  | { kind: 'ambiguous'; sessionIds: string[] }

const RUNS_LUMO = /(^|[\s;&|(`])lumo(\s|$)/

function field(payload: unknown, ...path: string[]): unknown {
  let cur: unknown = payload
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

/** Every argv token appears in `command`, in order, after the `lumo` word. */
function containsInOrder(command: string, argv: string[]): boolean {
  const m = RUNS_LUMO.exec(command)
  if (!m) return false
  let pos = m.index + m[0].length
  for (const token of argv) {
    const at = command.indexOf(token, pos)
    if (at < 0) return false
    pos = at + token.length
  }
  return true
}

export function matchPendingLumoCommand(
  events: ToolEventRow[],
  argv: string[]
): CallerMatch {
  const finished = new Set<string>()
  for (const e of events) {
    if (e.type === 'PRE_TOOL_USE') continue
    const id = field(e.payload, 'tool_use_id')
    if (typeof id === 'string') finished.add(id)
  }
  const sessions = new Set<string>()
  for (const e of events) {
    if (e.type !== 'PRE_TOOL_USE') continue
    const id = field(e.payload, 'tool_use_id')
    if (typeof id === 'string' && finished.has(id)) continue
    const command = field(e.payload, 'tool_input', 'command')
    if (typeof command !== 'string') continue
    if (containsInOrder(command, argv)) sessions.add(e.sessionId)
  }
  const list = [...sessions].sort()
  if (list.length === 0) return { kind: 'none' }
  if (list.length === 1) return { kind: 'one', sessionId: list[0]! }
  return { kind: 'ambiguous', sessionIds: list }
}
