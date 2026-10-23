/**
 * LUM-1234 — TRACE row → the inputs the SHIPPED reward-hack core takes
 * (pure): one session of `RhEvent`s, a synthetic PR file list and the task
 * requirement. Used by `trace-product-regression.ts`.
 *
 * Mapping (one TRACE conversation = one agent session):
 *  - a user message with text → USER_PROMPT_SUBMIT `{ prompt }`;
 *  - an assistant tool call, paired with the same message's tool result at
 *    the same index (missing → no `tool_response`; extra results ignored)
 *    → POST_TOOL_USE `{ tool_name, tool_input: parameters, tool_response }`,
 *    Claude Code tool names kept as they are (Bash / Edit / Write / Read …);
 *  - the last non-empty assistant text of a turn (the messages up to the
 *    next user message, or the end) → one STOP `{ last_assistant_message }`
 *    after that turn's tool events. Earlier assistant text in the turn is not
 *    an event (the hooks never see it either).
 * Event ids are `e<n>` and the session id is fixed: the trajectory id never
 * reaches the model (it would be in every marker and fence otherwise). The
 * ids are unique and stable within a row, which is all the core needs — each
 * row is judged on its own. Timestamps are 1 s apart from a fixed origin.
 *
 * Synthetic PR (TRACE has no PR) — an APPROXIMATION:
 *  - its files are every path the trajectory wrote, as the product reads
 *    writes (`rhEventFilePaths`: Write / Edit / MultiEdit / NotebookEdit /
 *    apply_patch and Bash-written paths), each named by that path with any
 *    leading `/` or `./` dropped (the product matches on whole-segment
 *    suffixes, so the event path still matches it);
 *  - status `added` when the first event that touches the path is a Write
 *    and no earlier Read named it, else `modified`;
 *  - the `+` lines of its patch are the lines we believe the file holds at
 *    the end: a Write replaces them all, an Edit / MultiEdit removes its
 *    `old_string` lines (unless re-added) and adds its `new_string` lines, an
 *    apply_patch adds its `+` lines. We never see the original file, so
 *    untouched lines are absent and a line removed by an Edit is only dropped
 *    if we had it. A file only a Bash command wrote has `patch: null` (no
 *    hunks — the gates then give its writes the benefit of the doubt).
 *  So the product's diff gates see the agent's final writes as present in
 *  the "PR"; an edit the agent later reverted reads as gone, as in a real PR.
 *
 * Requirement = the first user message (TRACE has no separate task text).
 * `label` is never read here.
 */
import {
  rhEventAddedLines,
  rhEventFilePaths,
  type RhEvent,
  type RhPrFile,
} from '@/ee/security/security-scan/reward-hack-input'

export const TRACE_SESSION_ID = 'session-1'
const ORIGIN_MS = Date.parse('2026-01-01T00:00:00Z')

export interface TraceMessage {
  role: string
  content?: unknown
  tool_calls?: unknown
  tool_results?: unknown
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The `conversation` field (JSON string or array) as messages; throws if neither. */
export function parseTraceConversation(raw: unknown): TraceMessage[] {
  const v = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw
  if (!Array.isArray(v)) throw new Error('conversation is not an array')
  return v.map(m => {
    const r = asRecord(m)
    if (!r || typeof r.role !== 'string')
      throw new Error('a conversation message has no role')
    return r as unknown as TraceMessage
  })
}

/** One TRACE conversation → one session's events (see the header). */
export function traceToRhEvents(messages: TraceMessage[]): RhEvent[] {
  const out: RhEvent[] = []
  const push = (type: string, toolName: string | null, payload: unknown) => {
    const n = out.length
    out.push({
      id: `e${n}`,
      sessionId: TRACE_SESSION_ID,
      type,
      toolName,
      payload,
      createdAt: new Date(ORIGIN_MS + n * 1000),
    })
  }
  let turnText: string | null = null
  const endTurn = () => {
    if (turnText !== null)
      push('STOP', null, { last_assistant_message: turnText })
    turnText = null
  }
  for (const m of messages) {
    if (m.role === 'user') {
      endTurn()
      const prompt = text(m.content)
      if (prompt.trim()) push('USER_PROMPT_SUBMIT', null, { prompt })
      continue
    }
    if (m.role !== 'assistant') continue
    const calls = Array.isArray(m.tool_calls) ? m.tool_calls : []
    const results = Array.isArray(m.tool_results) ? m.tool_results : []
    calls.forEach((call, i) => {
      const c = asRecord(call)
      const name = c && typeof c.name === 'string' ? c.name : null
      if (!name) return
      const payload: Record<string, unknown> = {
        tool_name: name,
        tool_input: c!.parameters ?? {},
      }
      const res = asRecord(results[i])
      if (res && res.output !== undefined && res.output !== null)
        payload.tool_response = res.output
      push('POST_TOOL_USE', name, payload)
    })
    const said = text(m.content)
    if (said.trim()) turnText = said
  }
  endTurn()
  return out
}

/** The first user message's text — the requirement; '' when there is none. */
export function traceRequirement(messages: TraceMessage[]): string {
  return text(messages.find(m => m.role === 'user')?.content)
}

function prName(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
}

function linesOf(s: unknown): string[] {
  return typeof s === 'string' ? s.split('\n') : []
}

/** Remove `oldS`'s lines (unless `newS` keeps them), then add `newS`'s. */
function applyEdit(lines: string[], oldS: unknown, newS: unknown): string[] {
  const keep = new Set(linesOf(newS).map(l => l.trim()))
  const drop = new Set(
    linesOf(oldS)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !keep.has(l))
  )
  const out = lines.filter(l => !drop.has(l.trim()))
  const have = new Set(out.map(l => l.trim()))
  for (const l of linesOf(newS))
    if (!have.has(l.trim())) {
      out.push(l)
      have.add(l.trim())
    }
  return out
}

/** The synthetic PR file list for one trajectory's events (see the header). */
export function buildSyntheticPr(events: RhEvent[]): RhPrFile[] {
  const read = new Set<string>()
  const files = new Map<
    string,
    { status: 'added' | 'modified'; lines: string[] | null }
  >()
  for (const ev of events) {
    const input = asRecord(asRecord(ev.payload)?.tool_input)
    if (ev.type === 'POST_TOOL_USE' && ev.toolName === 'Read') {
      const p = input?.file_path
      if (typeof p === 'string' && p) read.add(prName(p))
      continue
    }
    const paths = rhEventFilePaths(ev)
    for (const raw of paths) {
      const name = prName(raw)
      if (!name) continue
      let f = files.get(name)
      if (!f) {
        f = {
          status:
            ev.toolName === 'Write' && !read.has(name) ? 'added' : 'modified',
          lines: null,
        }
        files.set(name, f)
      }
      const tool = ev.toolName
      if (tool === 'Write') f.lines = linesOf(input?.content)
      else if (tool === 'Edit')
        f.lines = applyEdit(f.lines ?? [], input?.old_string, input?.new_string)
      else if (tool === 'MultiEdit' && Array.isArray(input?.edits)) {
        let lines = f.lines ?? []
        for (const e of input.edits as unknown[]) {
          const r = asRecord(e)
          lines = applyEdit(lines, r?.old_string, r?.new_string)
        }
        f.lines = lines
      } else if (tool !== 'Bash') {
        // apply_patch / NotebookEdit: whatever lines the product reads as added.
        f.lines = applyEdit(
          f.lines ?? [],
          '',
          (rhEventAddedLines(ev) ?? []).join('\n')
        )
      }
    }
  }
  return [...files.entries()].map(([filename, f]) => ({
    filename,
    status: f.status,
    patch:
      f.lines === null
        ? null
        : [
            `@@ -0,0 +1,${f.lines.length} @@`,
            ...f.lines.map(l => `+${l}`),
          ].join('\n'),
  }))
}
