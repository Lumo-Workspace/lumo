/**
 * Compact a stream of HookEvent rows into a terse, Claude-friendly event log.
 *
 * A full POST_TOOL_USE payload can easily be 5-50 KB (file contents, stdout).
 * For a 200-event session that's megabytes — well past useful context. We
 * squash each Pre+Post pair into a single line with just the signal:
 *
 *     [HH:MM:SS] Tool <key-input> → <short-result>
 *
 * Pure: no React, no Prisma, no I/O — trivially unit-testable.
 */

export type HookEventType = 'PRE_TOOL_USE' | 'POST_TOOL_USE' | 'STOP'

export interface RawEvent {
  id: string
  type: HookEventType
  toolName: string | null
  payload: unknown
  createdAt: Date
}

export interface CompactOptions {
  /** Max tool-call lines to emit before truncating. Default 150. */
  maxToolCalls?: number
  /** Max chars of stdout/stderr to keep per Bash tool call. Default 500. */
  bashOutputHeadChars?: number
}

export interface CompactResult {
  /** One line per merged tool call or STOP event, newline-separated. */
  text: string
  /** Count of tool-call lines actually emitted. */
  toolCallLineCount: number
  /** Count of tool calls dropped past maxToolCalls (0 if none). */
  truncatedCount: number
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function compactEvents(
  events: RawEvent[],
  options: CompactOptions = {}
): CompactResult {
  const maxToolCalls = options.maxToolCalls ?? 150
  const bashOutputHead = options.bashOutputHeadChars ?? 500

  const lines: string[] = []
  let toolCallLineCount = 0
  let truncatedCount = 0

  const preByToolUseId = new Map<string, RawEvent>()

  for (const ev of events) {
    if (ev.type === 'STOP') {
      lines.push(compactStop(ev))
      continue
    }

    const toolUseId = getString(ev.payload, 'tool_use_id')
    if (ev.type === 'PRE_TOOL_USE') {
      if (toolUseId) {
        preByToolUseId.set(toolUseId, ev)
      } else {
        emitToolLine(ev, null)
      }
      continue
    }

    // POST_TOOL_USE
    const pre = toolUseId ? preByToolUseId.get(toolUseId) : undefined
    if (pre && toolUseId) preByToolUseId.delete(toolUseId)
    emitToolLine(pre ?? null, ev)
  }

  // Orphan Pre events (no Post arrived before session ended).
  for (const pre of preByToolUseId.values()) {
    emitToolLine(pre, null)
  }

  return {
    text: lines.join('\n'),
    toolCallLineCount,
    truncatedCount,
  }

  function emitToolLine(pre: RawEvent | null, post: RawEvent | null) {
    if (toolCallLineCount >= maxToolCalls) {
      truncatedCount++
      return
    }
    const line = compactToolCall(pre, post, bashOutputHead)
    if (line) {
      lines.push(line)
      toolCallLineCount++
    }
  }
}

// ─── Per-event compaction ───────────────────────────────────────────────────

function compactToolCall(
  pre: RawEvent | null,
  post: RawEvent | null,
  bashOutputHead: number
): string | null {
  const anchor = pre ?? post
  if (!anchor) return null
  const t = formatTime(anchor.createdAt)
  const tool = anchor.toolName ?? 'Unknown'
  const input = getRecord(anchor.payload, 'tool_input')
  const response = post ? getRecord(post.payload, 'tool_response') : null
  const postArrived = post !== null

  const body = compactForTool(
    tool,
    input,
    response,
    postArrived,
    bashOutputHead
  )
  return `[${t}] ${body}`
}

function compactForTool(
  tool: string,
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  postArrived: boolean,
  bashOutputHead: number
): string {
  if (!postArrived) {
    return `${tool} ${compactInput(tool, input)} (no result — session ended mid-call)`
  }
  switch (tool) {
    case 'Bash': {
      const cmd = truncateSingleLine(getString(input, 'command') ?? '', 120)
      const stdout = getString(response, 'stdout') ?? ''
      const stderr = getString(response, 'stderr') ?? ''
      const interrupted = getBoolean(response, 'interrupted') === true
      const status = interrupted ? 'INTERRUPTED' : stderr.trim() ? 'ERR' : 'OK'
      const tail = interrupted
        ? ''
        : stderr.trim()
          ? ` — stderr: ${truncateSingleLine(stderr, bashOutputHead)}`
          : stdout.trim()
            ? ` — stdout: ${truncateSingleLine(stdout, bashOutputHead)}`
            : ''
      return `Bash "${cmd}" ${status}${tail}`
    }
    case 'Read': {
      const path = getString(input, 'file_path') ?? '(no path)'
      const file = getRecord(response, 'file')
      const content = getString(file, 'content') ?? ''
      const lines = content ? content.split('\n').length : 0
      return lines > 0 ? `Read ${path} (${lines} lines)` : `Read ${path}`
    }
    case 'Edit':
    case 'MultiEdit': {
      const path =
        getString(input, 'file_path') ??
        getString(response, 'filePath') ??
        '(no path)'
      const changes = countPatchChanges(getAny(response, 'structuredPatch'))
      return changes
        ? `${tool} ${path} +${changes.added} -${changes.removed}`
        : `${tool} ${path}`
    }
    case 'Write': {
      const path =
        getString(input, 'file_path') ??
        getString(response, 'filePath') ??
        '(no path)'
      const content = getString(input, 'content') ?? ''
      const lines = content ? content.split('\n').length : 0
      const kind = getString(response, 'type') ?? 'write'
      return `Write ${path} (${kind}, ${lines} lines)`
    }
    case 'Grep': {
      const pattern = getString(input, 'pattern') ?? ''
      const path = getString(input, 'path')
      const mode = getString(response, 'mode')
      const numFiles = getNumber(response, 'numFiles')
      const numLines = getNumber(response, 'numLines')
      const numMatches = getNumber(response, 'numMatches')
      const where = path ? ` in ${path}` : ''
      const count =
        mode === 'files_with_matches' && numFiles !== null
          ? `${numFiles} files`
          : mode === 'content' && numLines !== null
            ? `${numLines} lines`
            : mode === 'count' && numMatches !== null
              ? `${numMatches} matches`
              : 'result'
      return `Grep "${pattern}"${where} → ${count}`
    }
    case 'Glob': {
      const pattern = getString(input, 'pattern') ?? ''
      const numFiles =
        getNumber(response, 'numFiles') ??
        (Array.isArray(getAny(response, 'filenames'))
          ? (getAny(response, 'filenames') as unknown[]).length
          : null)
      return `Glob "${pattern}" → ${numFiles ?? 0} files`
    }
    case 'TodoWrite': {
      const todosRaw = getAny(input, 'todos')
      const todos = Array.isArray(todosRaw) ? todosRaw : []
      const counts: Record<string, number> = {}
      for (const t of todos) {
        const s = getString(t, 'status') ?? 'unknown'
        counts[s] = (counts[s] ?? 0) + 1
      }
      const summary = Object.entries(counts)
        .map(([s, n]) => `${n} ${s}`)
        .join(', ')
      return `TodoWrite (${todos.length} items: ${summary})`
    }
    default: {
      const hasError =
        getString(response, 'error') || getString(response, 'type') === 'error'
      return hasError
        ? `${tool} ${compactInput(tool, input)} ERR`
        : `${tool} ${compactInput(tool, input)}`
    }
  }
}

function compactInput(
  _tool: string,
  input: Record<string, unknown> | null
): string {
  if (!input) return ''
  const keys = Object.keys(input)
  if (keys.length === 0) return ''
  return keys.slice(0, 3).join(',')
}

function compactStop(ev: RawEvent): string {
  const t = formatTime(ev.createdAt)
  const last = getString(ev.payload, 'last_assistant_message')
  if (!last) return `[${t}] [turn end]`
  return `[${t}] [turn end] "${truncateSingleLine(last, 200)}"`
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function countPatchChanges(
  patch: unknown
): { added: number; removed: number } | null {
  if (!Array.isArray(patch)) return null
  let added = 0
  let removed = 0
  for (const hunk of patch) {
    const lines = (hunk as Record<string, unknown>).lines
    if (!Array.isArray(lines)) continue
    for (const line of lines) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+') && !line.startsWith('+++')) added++
      else if (line.startsWith('-') && !line.startsWith('---')) removed++
    }
  }
  return { added, removed }
}

function truncateSingleLine(s: string, maxLen: number): string {
  const oneLine = s.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= maxLen) return oneLine
  return oneLine.slice(0, maxLen - 1) + '…'
}

function formatTime(d: Date): string {
  return d.toISOString().slice(11, 19)
}

function getRecord(
  source: unknown,
  key: string
): Record<string, unknown> | null {
  if (source && typeof source === 'object') {
    const val = (source as Record<string, unknown>)[key]
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return val as Record<string, unknown>
    }
  }
  return null
}

function getString(source: unknown, key: string): string | null {
  if (source && typeof source === 'object') {
    const val = (source as Record<string, unknown>)[key]
    if (typeof val === 'string') return val
  }
  return null
}

function getBoolean(source: unknown, key: string): boolean | null {
  if (source && typeof source === 'object') {
    const val = (source as Record<string, unknown>)[key]
    if (typeof val === 'boolean') return val
  }
  return null
}

function getNumber(source: unknown, key: string): number | null {
  if (source && typeof source === 'object') {
    const val = (source as Record<string, unknown>)[key]
    if (typeof val === 'number' && Number.isFinite(val)) return val
  }
  return null
}

function getAny(source: unknown, key: string): unknown {
  if (source && typeof source === 'object') {
    return (source as Record<string, unknown>)[key]
  }
  return undefined
}
