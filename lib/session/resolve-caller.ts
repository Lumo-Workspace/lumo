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

// A `lumo` word at command start or after whitespace / ; & | ( , optionally
// path-qualified (/usr/local/bin/lumo). Residual risk: `lumo` inside quoted
// prose (git commit -m "fix lumo verify") still counts when the argv tokens
// follow it as whole words; the cost is an "ambiguous" answer, never a wrong
// pick when only one session is pending.
const RUNS_LUMO = /(?:^|[\s;&|(])(?:[^\s;&|()]*\/)?lumo(?=\s|$)/g

function field(payload: unknown, ...path: string[]): unknown {
  let cur: unknown = payload
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur
}

const BEFORE_OK = /[\s"']/
const AFTER_OK = /[\s"';&|)]/

/** Index of `token` as a whole shell word at or after `from`, else -1. */
function indexOfWholeToken(
  command: string,
  token: string,
  from: number
): number {
  if (!token) return -1
  let at = command.indexOf(token, from)
  while (at >= 0) {
    const end = at + token.length
    const beforeOk = at === 0 || BEFORE_OK.test(command[at - 1]!)
    const afterOk = end >= command.length || AFTER_OK.test(command[end]!)
    if (beforeOk && afterOk) return at
    at = command.indexOf(token, at + 1)
  }
  return -1
}

/** Every argv token is a whole word of `command`, in order, after a `lumo` word. */
function containsInOrder(command: string, argv: string[]): boolean {
  for (const m of command.matchAll(RUNS_LUMO)) {
    let pos = m.index! + m[0].length
    let ok = true
    for (const token of argv) {
      const at = indexOfWholeToken(command, token, pos)
      if (at < 0) {
        ok = false
        break
      }
      pos = at + token.length
    }
    if (ok) return true
  }
  return false
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
    // Without an id we cannot prove the command is still pending.
    if (typeof id !== 'string' || finished.has(id)) continue
    const command = field(e.payload, 'tool_input', 'command')
    if (typeof command !== 'string') continue
    if (containsInOrder(command, argv)) sessions.add(e.sessionId)
  }
  const list = [...sessions].sort()
  if (list.length === 0) return { kind: 'none' }
  if (list.length === 1) return { kind: 'one', sessionId: list[0]! }
  return { kind: 'ambiguous', sessionIds: list }
}
