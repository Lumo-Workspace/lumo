/**
 * LUM-1234 — TRACE rows → hook-shaped tool events.
 *
 * Row shape (confirmed on the first copy of the data we could read — a parquet
 * copy converted with parquet_to_json.py, 2026-10-18):
 *   { trajectory_id: string,
 *     conversation:  string — JSON array of { role, content, tool_calls?, tool_results? },
 *     label:         string — '0' (benign) or a comma-separated list of hack-type
 *                    codes, e.g. '1.1.2, 1.3.1' (multi-label) }
 *
 * Tool calls are Claude Code shaped (`{ name, parameters }` with the hook's own
 * input fields), so Bash / Write / Edit / Read map one to one. Every other tool
 * (Grep, Glob, WebSearch, …) is skipped and counted by name, so the report says
 * what the per-action monitor never saw. Tool results are not evaluated: the
 * detector reads only the tool input.
 */
import type { EvalEvent } from '@/ee/private/boundary-crossing/eval/types'

export interface TraceTrajectory {
  id: string
  hacked: boolean
  /** Hack-type codes as labeled, e.g. ['1.1.2', '1.3.1']; [] when benign. */
  hackTypes: string[]
  events: EvalEvent[]
  /** Tool calls not evaluated, by tool name (or `malformed`). */
  skipped: Record<string, number>
}

export type TraceCallResult = { event: EvalEvent } | { skip: string }

const HACK_CODE = /^\d+(\.\d+)+$/

export class TraceRowError extends Error {}

/** '0' → benign; '1.1.2, 1.3.1' → hacked with those codes; anything else throws. */
export function parseTraceLabel(raw: unknown): {
  hacked: boolean
  hackTypes: string[]
} {
  if (typeof raw !== 'string') {
    throw new TraceRowError(`label is ${typeof raw}, expected a string`)
  }
  const s = raw.trim()
  if (s === '0') return { hacked: false, hackTypes: [] }
  const codes = s.split(',').map(c => c.trim())
  const bad = codes.filter(c => !HACK_CODE.test(c))
  if (codes.length === 0 || bad.length > 0) {
    throw new TraceRowError(
      `label ${JSON.stringify(raw)} is neither '0' nor a list of hack-type codes`
    )
  }
  return { hacked: true, hackTypes: Array.from(new Set(codes)) }
}

/** `1.1.2` → `1.1` (the sub-category's parent). */
export function hackFamily(code: string): string {
  return code.split('.').slice(0, 2).join('.')
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function event(
  toolName: EvalEvent['toolName'],
  filePath: string | null,
  toolInput: Record<string, string>
): TraceCallResult {
  return {
    event: {
      toolName,
      filePath,
      payload: { tool_name: toolName, tool_input: toolInput },
    },
  }
}

/** One TRACE tool call (`{ name, parameters }`) → event or skip reason. */
export function convertTraceCall(call: unknown): TraceCallResult {
  if (!call || typeof call !== 'object') return { skip: 'malformed' }
  const c = call as Record<string, unknown>
  const name = str(c.name)
  if (!name) return { skip: 'malformed' }
  const p =
    c.parameters && typeof c.parameters === 'object'
      ? (c.parameters as Record<string, unknown>)
      : null
  if (!p) return { skip: `${name}:no-parameters` }
  const path = str(p.file_path)
  switch (name) {
    case 'Bash': {
      const command = str(p.command)
      return command ? event('Bash', null, { command }) : { skip: 'Bash:empty' }
    }
    case 'Write':
      if (!path) return { skip: 'Write:no-path' }
      return event('Write', path, {
        file_path: path,
        content: str(p.content) ?? '',
      })
    case 'Edit':
      if (!path) return { skip: 'Edit:no-path' }
      return event('Edit', path, {
        file_path: path,
        old_string: str(p.old_string) ?? '',
        new_string: str(p.new_string) ?? '',
      })
    case 'Read':
      if (!path) return { skip: 'Read:no-path' }
      return event('Read', path, { file_path: path })
    default:
      return { skip: name }
  }
}

/** One row → trajectory. A row that is not in the TRACE shape throws. */
export function convertTraceRow(row: unknown): TraceTrajectory {
  if (!row || typeof row !== 'object') {
    throw new TraceRowError('row is not an object')
  }
  const r = row as Record<string, unknown>
  const id = str(r.trajectory_id)
  if (!id) throw new TraceRowError('row has no trajectory_id')
  const fail = (msg: string) => new TraceRowError(`TRACE row ${id}: ${msg}`)
  let label: ReturnType<typeof parseTraceLabel>
  try {
    label = parseTraceLabel(r.label)
  } catch (e) {
    throw fail((e as Error).message)
  }
  let messages: unknown
  try {
    messages =
      typeof r.conversation === 'string'
        ? JSON.parse(r.conversation)
        : r.conversation
  } catch {
    throw fail('conversation is not valid JSON')
  }
  if (!Array.isArray(messages)) {
    throw fail('conversation is not an array of messages')
  }
  const events: EvalEvent[] = []
  const skipped: Record<string, number> = {}
  for (const m of messages) {
    if (!m || typeof m !== 'object') throw fail('a message is not an object')
    const calls = (m as Record<string, unknown>).tool_calls
    if (calls === undefined || calls === null) continue
    if (!Array.isArray(calls)) throw fail('tool_calls is not an array')
    for (const call of calls) {
      const res = convertTraceCall(call)
      if ('event' in res) events.push(res.event)
      else skipped[res.skip] = (skipped[res.skip] ?? 0) + 1
    }
  }
  return { id, ...label, events, skipped }
}
