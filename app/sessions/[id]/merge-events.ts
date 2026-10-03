/**
 * Merge raw HookEvent rows into user-facing timeline items.
 *
 * A "tool call" is the Pre+Post pair sharing a tool_use_id. STOP events and
 * orphans (Pre without Post, or Post without Pre) each get their own item.
 *
 * Pure: no React, no Prisma, no I/O — trivially unit-testable.
 */

import {
  isPrunedPayload,
  isUserDeletedPayload,
} from '@/lib/hook-event/retention'
import {
  readRedactedPatch,
  readRedactedStats,
  sumRedactedStats,
  type RedactedPatchStats,
  type RedactedSize,
  type RedactedStats,
} from '@/lib/hook-payload/redact'

/** Locale-free kinds for detail-block labels; the view maps them to intl keys. */
export type BlockLabelKey =
  | 'prompt'
  | 'rawWithContext'
  | 'lastMessage'
  | 'command'
  | 'stdout'
  | 'stderr'
  | 'status'
  | 'content'
  | 'diff'
  | 'old'
  | 'new'
  | 'matches'
  | 'response'
  | 'files'
  | 'todos'
  | 'input'

export type HookEventType =
  | 'PRE_TOOL_USE'
  | 'POST_TOOL_USE'
  | 'STOP'
  | 'USER_PROMPT_SUBMIT'

export interface RawEvent {
  id: string
  type: HookEventType
  toolName: string | null
  payload: unknown
  createdAt: Date
}

export type DetailVariant =
  | 'text'
  | 'error'
  | 'diff'
  | 'code'
  | 'json'
  | 'redacted'

export interface DetailBlock {
  labelKey: BlockLabelKey
  variant: DetailVariant
  text: string
  /** Locale-free replacement for `text` (view resolves via intl). */
  textKey?: 'interrupted'
  truncated?: { shownLines: number; totalLines: number }
  /** Set on a `redacted` block (LUM-855): the size of content Lumo did not
   *  keep. `text` is empty — the view renders the not-retained notice. */
  redacted?: { lines: number; bytes: number }
}

/** Locale-free collapsed-row copy; the view resolves it via intl. Raw values
 *  (counts, patterns, paths) are data and travel as fields. */
export type SummaryMsg =
  | { kind: 'emptyPrompt' }
  | { kind: 'modelStopped' }
  | { kind: 'noInput' }
  | { kind: 'noPath' }
  | { kind: 'todos'; count: number }
  | { kind: 'grepIn'; pattern: string; path: string }

/** Locale-free trailing badge. `raw` is data (e.g. "+12 -3"). */
export type BadgeMsg =
  | { kind: 'raw'; text: string }
  | { kind: 'interrupted' }
  | { kind: 'stderr' }
  | { kind: 'noMatch' }
  | { kind: 'lines'; count: number }
  | { kind: 'linesWithType'; type: string; count: number }
  | { kind: 'files'; count: number }
  | { kind: 'matches'; count: number }

export type ItemStatus = 'ok' | 'error' | 'pending'

export interface TimelineItem {
  key: string
  kind: 'tool' | 'stop' | 'orphan' | 'user-prompt'
  toolName: string | null
  /** One-line description shown when collapsed. Empty when `pruned`. */
  summary: string
  /** The retention sweep cleared this event's payload (LUM-859); the view
   *  renders the localized notice instead of `summary`. */
  pruned: boolean
  /** LUM-944: the payload was cleared by a member's delete (implies `pruned`). */
  deleted: boolean
  /** Set instead of `summary` for placeholder / parametric row text. */
  summaryMsg: SummaryMsg | null
  /** Short trailing badge, e.g. "+12 -3" or "3 lines". Optional. */
  badge: BadgeMsg | null
  status: ItemStatus
  startAt: Date
  endAt: Date | null
  details: DetailBlock[]
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function mergeEvents(events: RawEvent[]): TimelineItem[] {
  const items: TimelineItem[] = []
  const preByToolUseId = new Map<string, RawEvent>()

  for (const ev of events) {
    // LUM-859: a pruned payload has no tool_use_id / prompt / message to read.
    // One row per cleared call — the Post carries it, so a cleared Pre is
    // skipped rather than left dangling as "pending".
    if (isPrunedPayload(ev.payload)) {
      if (ev.type !== 'PRE_TOOL_USE') items.push(prunedItem(ev))
      continue
    }

    if (ev.type === 'USER_PROMPT_SUBMIT') {
      items.push(userPromptItem(ev))
      continue
    }

    if (ev.type === 'STOP') {
      items.push(stopItem(ev))
      continue
    }

    const toolUseId = getString(ev.payload, 'tool_use_id')
    if (ev.type === 'PRE_TOOL_USE') {
      if (toolUseId) {
        preByToolUseId.set(toolUseId, ev)
      } else {
        items.push(toolItem(ev, null))
      }
      continue
    }

    // POST_TOOL_USE
    const pre = toolUseId ? preByToolUseId.get(toolUseId) : undefined
    if (pre && toolUseId) preByToolUseId.delete(toolUseId)
    items.push(toolItem(pre ?? null, ev))
  }

  // Orphan Pre events (no matching Post) — render as pending.
  for (const pre of preByToolUseId.values()) {
    items.push(toolItem(pre, null))
  }

  items.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
  return items
}

// ─── Item builders ──────────────────────────────────────────────────────────

function prunedItem(ev: RawEvent): TimelineItem {
  return {
    key: ev.id,
    kind:
      ev.type === 'STOP'
        ? 'stop'
        : ev.type === 'USER_PROMPT_SUBMIT'
          ? 'user-prompt'
          : 'tool',
    toolName: ev.toolName,
    summary: '',
    pruned: true,
    deleted: isUserDeletedPayload(ev.payload),
    summaryMsg: null,
    badge: null,
    status: 'ok',
    startAt: ev.createdAt,
    endAt: ev.createdAt,
    details: [],
  }
}

function userPromptItem(ev: RawEvent): TimelineItem {
  const rawPrompt = getString(ev.payload, 'prompt') ?? ''
  const stripped = stripInjectedTags(rawPrompt)
  const cleaned = stripped.trim()

  const summary = cleaned ? clip(cleaned, 100) : ''
  const summaryMsg: SummaryMsg | null = cleaned ? null : { kind: 'emptyPrompt' }
  const details: DetailBlock[] = []
  if (cleaned) {
    details.push({ labelKey: 'prompt', variant: 'text', text: cleaned })
  }
  if (rawPrompt && stripped !== rawPrompt) {
    details.push({
      labelKey: 'rawWithContext',
      variant: 'text',
      text: rawPrompt,
    })
  }

  return {
    key: ev.id,
    kind: 'user-prompt',
    toolName: null,
    summary,
    pruned: false,
    deleted: false,
    summaryMsg,
    badge: null,
    status: 'ok',
    startAt: ev.createdAt,
    endAt: ev.createdAt,
    details,
  }
}

function stopItem(ev: RawEvent): TimelineItem {
  const last = getString(ev.payload, 'last_assistant_message')
  const summary = last ? clip(last, 100) : ''
  const summaryMsg: SummaryMsg | null = last ? null : { kind: 'modelStopped' }
  const details: DetailBlock[] = last
    ? [{ labelKey: 'lastMessage', variant: 'text', text: last }]
    : []
  return {
    key: ev.id,
    kind: 'stop',
    toolName: null,
    summary,
    pruned: false,
    deleted: false,
    summaryMsg,
    badge: null,
    status: 'ok',
    startAt: ev.createdAt,
    endAt: ev.createdAt,
    details,
  }
}

function toolItem(pre: RawEvent | null, post: RawEvent | null): TimelineItem {
  const anchor = pre ?? post!
  const toolName = anchor.toolName
  const input = getRecord(anchor.payload, 'tool_input')
  const response = post ? getRecord(post.payload, 'tool_response') : null

  const { summary, summaryMsg, badge, status, details } = formatTool(
    toolName,
    input,
    response,
    post !== null,
    redactionLookup(anchor.payload, post?.payload ?? null)
  )

  return {
    key: `tool:${getString(anchor.payload, 'tool_use_id') ?? anchor.id}`,
    kind: pre && !post ? 'orphan' : 'tool',
    toolName,
    summary,
    pruned: false,
    deleted: false,
    summaryMsg: summaryMsg ?? null,
    badge,
    status,
    startAt: anchor.createdAt,
    endAt: post?.createdAt ?? null,
    details,
  }
}

// ─── Per-tool formatters ────────────────────────────────────────────────────

/** Stats for content redacted out of a Pre/Post pair (LUM-855). The Post row
 *  carries both tool_input and tool_response redactions; the Pre row only
 *  tool_input — so Post is checked first. */
interface RedactionLookup {
  stats(path: string): RedactedStats | null
  patch(path: string): RedactedPatchStats | null
  /** Summed size of everything redacted at or beneath `prefix` (LUM-874):
   *  MultiEdit `edits.N.*`, nested MCP / Task / WebFetch responses. */
  sum(prefix: string): RedactedSize | null
}

const NO_REDACTION: RedactionLookup = {
  stats: () => null,
  patch: () => null,
  sum: () => null,
}

function redactionLookup(anchor: unknown, post: unknown): RedactionLookup {
  return {
    stats: path =>
      readRedactedStats(post, path) ?? readRedactedStats(anchor, path),
    patch: path =>
      readRedactedPatch(post, path) ?? readRedactedPatch(anchor, path),
    sum: prefix =>
      sumRedactedStats(post, prefix) ?? sumRedactedStats(anchor, prefix),
  }
}

function redactedBlock(
  labelKey: BlockLabelKey,
  stats: RedactedStats | RedactedSize | null
): DetailBlock | null {
  if (!stats) return null
  return {
    labelKey,
    variant: 'redacted',
    text: '',
    redacted: { lines: stats.lines, bytes: stats.bytes },
  }
}

/** Placeholder row text when a file tool carried no path. */
function noPath(filePath: string | null): { summaryMsg?: SummaryMsg } {
  return filePath === null ? { summaryMsg: { kind: 'noPath' } } : {}
}

function pushBlock(details: DetailBlock[], block: DetailBlock | null) {
  if (block) details.push(block)
}

interface FormatResult {
  summary: string
  summaryMsg?: SummaryMsg | undefined
  badge: BadgeMsg | null
  status: ItemStatus
  details: DetailBlock[]
}

function formatTool(
  toolName: string | null,
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  hasPost: boolean,
  redaction: RedactionLookup = NO_REDACTION
): FormatResult {
  const status: ItemStatus = !hasPost
    ? 'pending'
    : detectError(toolName, response, redaction)
      ? 'error'
      : 'ok'

  switch (toolName) {
    case 'Bash':
      return formatBash(input, response, status, redaction)
    case 'Read':
      return formatRead(input, response, status, redaction)
    case 'Edit':
    case 'MultiEdit':
      return formatEdit(input, response, status, redaction)
    case 'Write':
      return formatWrite(input, response, status, redaction)
    case 'NotebookEdit':
      return formatNotebookEdit(input, response, status, redaction)
    case 'Grep':
      return formatGrep(input, response, status, redaction)
    case 'Glob':
      return formatGlob(input, response, status)
    case 'TodoWrite':
      return formatTodoWrite(input, response, status)
    default:
      return formatFallback(input, response, status, redaction)
  }
}

function formatBash(
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  status: ItemStatus,
  redaction: RedactionLookup
): FormatResult {
  const command = getString(input, 'command') ?? ''
  const stdout = getString(response, 'stdout') ?? ''
  const stderr = getString(response, 'stderr') ?? ''
  const interrupted = getBoolean(response, 'interrupted') ?? false

  const details: DetailBlock[] = []
  details.push({ labelKey: 'command', variant: 'code', text: command })
  if (stdout.trim()) details.push(clipBlock('stdout', 'code', stdout, 40))
  if (stderr.trim()) details.push(clipBlock('stderr', 'error', stderr, 40))
  pushBlock(
    details,
    redactedBlock('stdout', redaction.stats('tool_response.stdout'))
  )
  const redactedStderr = redaction.stats('tool_response.stderr')
  pushBlock(details, redactedBlock('stderr', redactedStderr))
  if (interrupted)
    details.push({
      labelKey: 'status',
      variant: 'error',
      text: '',
      textKey: 'interrupted',
    })

  const summary = clip(command.replace(/\s+/g, ' '), 100)
  const hasStderr = stderr.trim() !== '' || (redactedStderr?.bytes ?? 0) > 0
  const badge: BadgeMsg | null = interrupted
    ? { kind: 'interrupted' }
    : hasStderr
      ? { kind: 'stderr' }
      : null

  return { summary, badge, status, details }
}

function formatRead(
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  status: ItemStatus,
  redaction: RedactionLookup
): FormatResult {
  const filePath = getString(input, 'file_path')
  const path = filePath ?? ''
  const file = getRecord(response, 'file')
  const content = getString(file, 'content') ?? ''
  const redacted = redaction.stats('tool_response.file.content')
  const totalLines = content
    ? content.split('\n').length
    : (redacted?.lines ?? 0)
  const details: DetailBlock[] = []
  if (content) details.push(clipBlock('content', 'code', content, 30))
  pushBlock(details, redactedBlock('content', redacted))

  const badge: BadgeMsg | null =
    totalLines > 0 ? { kind: 'lines', count: totalLines } : null
  return { summary: path, ...noPath(filePath), badge, status, details }
}

function formatEdit(
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  status: ItemStatus,
  redaction: RedactionLookup
): FormatResult {
  const filePath =
    getString(input, 'file_path') ?? getString(response, 'filePath')
  const path = filePath ?? ''

  const patch = renderStructuredPatch(getAny(response, 'structuredPatch'))
  const oldStr = getString(input, 'old_string') ?? ''
  const newStr = getString(input, 'new_string') ?? ''

  const details: DetailBlock[] = []
  if (patch) {
    details.push(clipBlock('diff', 'diff', patch, 60))
  } else if (oldStr || newStr) {
    if (oldStr) details.push(clipBlock('old', 'code', oldStr, 20))
    if (newStr) details.push(clipBlock('new', 'code', newStr, 20))
  } else if (multiEditStrings(input).length > 0) {
    // MultiEdit recorded in full: one old/new pair per edit.
    for (const edit of multiEditStrings(input)) {
      if (edit.oldStr) details.push(clipBlock('old', 'code', edit.oldStr, 20))
      if (edit.newStr) details.push(clipBlock('new', 'code', edit.newStr, 20))
    }
  } else {
    pushBlock(
      details,
      redactedBlock(
        'diff',
        redaction.stats('tool_input.new_string') ??
          redaction.stats('tool_input.old_string') ??
          // MultiEdit keeps its stats per edit under tool_input.edits.N.*
          redaction.sum('tool_input.edits')
      )
    )
  }

  const changes =
    countPatchChanges(getAny(response, 'structuredPatch')) ??
    redaction.patch('tool_response.structuredPatch')
  const badge: BadgeMsg | null =
    changes && (changes.added || changes.removed)
      ? { kind: 'raw', text: `+${changes.added} -${changes.removed}` }
      : null

  return { summary: path, ...noPath(filePath), badge, status, details }
}

function formatWrite(
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  status: ItemStatus,
  redaction: RedactionLookup
): FormatResult {
  const filePath =
    getString(input, 'file_path') ?? getString(response, 'filePath')
  const path = filePath ?? ''
  const content =
    getString(input, 'content') ?? getString(response, 'content') ?? ''
  const redacted = redaction.stats('tool_input.content')
  const totalLines = content
    ? content.split('\n').length
    : (redacted?.lines ?? 0)

  const details: DetailBlock[] = []
  if (content) details.push(clipBlock('content', 'code', content, 30))
  else pushBlock(details, redactedBlock('content', redacted))

  const kind = getString(response, 'type') ?? 'write'
  const badge: BadgeMsg =
    totalLines > 0
      ? { kind: 'linesWithType', type: kind, count: totalLines }
      : { kind: 'raw', text: kind }
  return { summary: path, ...noPath(filePath), badge, status, details }
}

/** Old/new strings of a fully recorded MultiEdit `edits` array. */
function multiEditStrings(
  input: Record<string, unknown> | null
): Array<{ oldStr: string; newStr: string }> {
  const edits = getAny(input, 'edits')
  if (!Array.isArray(edits)) return []
  return edits
    .map(edit => ({
      oldStr: getString(edit, 'old_string') ?? '',
      newStr: getString(edit, 'new_string') ?? '',
    }))
    .filter(edit => edit.oldStr || edit.newStr)
}

function formatNotebookEdit(
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  status: ItemStatus,
  redaction: RedactionLookup
): FormatResult {
  const notebookPath =
    getString(input, 'notebook_path') ?? getString(response, 'notebook_path')
  const source = getString(input, 'new_source') ?? ''
  const redacted = redaction.stats('tool_input.new_source')
  const totalLines = source ? source.split('\n').length : (redacted?.lines ?? 0)

  const details: DetailBlock[] = []
  // A failed edit (e.g. `Cell c not found`) shows its error text first.
  const errorText = getString(response, 'error')
  if (errorText) details.push(clipBlock('response', 'error', errorText, 20))
  // The response's `original_file` / `updated_file` (whole-notebook JSON) are
  // deliberately never rendered — only the edited cell source is shown, or
  // its size when it was not retained (LUM-874).
  if (source) details.push(clipBlock('content', 'code', source, 30))
  else if (redacted) pushBlock(details, redactedBlock('content', redacted))
  else {
    // No cell source (`edit_mode: 'delete'`): show the input like the generic
    // fallback does, plus the size of whatever the response did not retain,
    // so the expanded row is never blank.
    if (input)
      details.push({
        labelKey: 'input',
        variant: 'json',
        text: stringifyJson(input),
      })
    pushBlock(
      details,
      redactedBlock('response', redaction.sum('tool_response'))
    )
  }

  const badge: BadgeMsg | null =
    totalLines > 0 ? { kind: 'lines', count: totalLines } : null
  return {
    summary: notebookPath ?? '',
    ...noPath(notebookPath),
    badge,
    status,
    details,
  }
}

function formatGrep(
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  status: ItemStatus,
  redaction: RedactionLookup
): FormatResult {
  const pattern = getString(input, 'pattern') ?? ''
  const path = getString(input, 'path')
  const summary = path ? '' : pattern
  const summaryMsg: SummaryMsg | undefined = path
    ? { kind: 'grepIn', pattern, path }
    : undefined

  const details: DetailBlock[] = []
  const mode = getString(response, 'mode')
  const numFiles = getNumber(response, 'numFiles')
  const numLines = getNumber(response, 'numLines')
  const numMatches = getNumber(response, 'numMatches')
  const filenames = extractListOfStrings(response, ['filenames'])
  const content = getString(response, 'content')

  // files_with_matches mode: grep --files-with-matches → show file list
  if (filenames && filenames.length > 0) {
    details.push(clipBlock('matches', 'code', filenames.join('\n'), 40))
  }
  // content mode: rg default → show matched lines (content is a string)
  else if (content && content.trim()) {
    details.push(clipBlock('matches', 'code', content, 40))
  }
  // content mode, matched lines not retained (LUM-855)
  else if (redaction.stats('tool_response.content')) {
    pushBlock(
      details,
      redactedBlock('matches', redaction.stats('tool_response.content'))
    )
  }
  // count mode or empty result: nothing interesting to expand
  else if (response && mode !== 'count' && numFiles !== 0 && numLines !== 0) {
    details.push({
      labelKey: 'response',
      variant: 'json',
      text: stringifyJson(response),
    })
  }

  // Badge: prefer the count the mode actually populates.
  const badge: BadgeMsg | null =
    mode === 'files_with_matches' && numFiles !== null
      ? numFiles === 0
        ? { kind: 'noMatch' }
        : { kind: 'files', count: numFiles }
      : mode === 'content' && numLines !== null
        ? numLines === 0
          ? { kind: 'noMatch' }
          : { kind: 'lines', count: numLines }
        : mode === 'count' && numMatches !== null
          ? { kind: 'matches', count: numMatches }
          : numFiles !== null
            ? { kind: 'files', count: numFiles }
            : null

  return { summary, summaryMsg, badge, status, details }
}

function formatGlob(
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  status: ItemStatus
): FormatResult {
  const pattern = getString(input, 'pattern') ?? ''
  const details: DetailBlock[] = []

  const files = extractListOfStrings(response, ['filenames', 'files'])
  const numFiles = getNumber(response, 'numFiles')

  if (files && files.length > 0) {
    details.push(clipBlock('files', 'code', files.join('\n'), 40))
  } else if (response) {
    details.push({
      labelKey: 'response',
      variant: 'json',
      text: stringifyJson(response),
    })
  }

  const badge: BadgeMsg | null =
    numFiles !== null
      ? { kind: 'files', count: numFiles }
      : files
        ? { kind: 'files', count: files.length }
        : null

  return { summary: pattern, badge, status, details }
}

function formatTodoWrite(
  input: Record<string, unknown> | null,
  _response: Record<string, unknown> | null,
  status: ItemStatus
): FormatResult {
  const todosRaw = getAny(input, 'todos')
  const todos = Array.isArray(todosRaw) ? todosRaw : []
  const summaryMsg: SummaryMsg = { kind: 'todos', count: todos.length }
  const details: DetailBlock[] = []
  if (todos.length) {
    const lines = todos.map((t, i) => {
      const obj = t as Record<string, unknown>
      const content = getString(obj, 'content') ?? ''
      const st = getString(obj, 'status') ?? ''
      return `${i + 1}. [${st}] ${content}`
    })
    details.push(clipBlock('todos', 'text', lines.join('\n'), 30))
  }
  return { summary: '', summaryMsg, badge: null, status, details }
}

function formatFallback(
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  status: ItemStatus,
  redaction: RedactionLookup
): FormatResult {
  const summary = input ? clip(stringifyJson(input).slice(1, -1), 100) : ''
  const summaryMsg: SummaryMsg | undefined = input
    ? undefined
    : { kind: 'noInput' }
  const details: DetailBlock[] = []
  if (input)
    details.push({
      labelKey: 'input',
      variant: 'json',
      text: stringifyJson(input),
    })
  if (response)
    details.push({
      labelKey: 'response',
      variant: 'json',
      text: stringifyJson(response),
    })
  // LUM-874: redacted content may sit anywhere inside the input or response
  // (MCP / Task `content[].text`, WebFetch `result`), not only as a bare
  // string — show the summed size of what was not retained.
  pushBlock(details, redactedBlock('input', redaction.sum('tool_input')))
  pushBlock(details, redactedBlock('response', redaction.sum('tool_response')))
  return { summary, summaryMsg, badge: null, status, details }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectError(
  toolName: string | null,
  response: Record<string, unknown> | null,
  redaction: RedactionLookup
): boolean {
  if (!response) return false
  if (toolName === 'Bash') {
    const stderr = getString(response, 'stderr') ?? ''
    if (stderr.trim().length > 0) return true
    if ((redaction.stats('tool_response.stderr')?.bytes ?? 0) > 0) return true
    if (getBoolean(response, 'interrupted')) return true
    return false
  }
  if (getString(response, 'type') === 'error') return true
  if (getString(response, 'error')) return true
  return false
}

function renderStructuredPatch(patch: unknown): string | null {
  if (!Array.isArray(patch)) return null
  const parts: string[] = []
  for (const hunk of patch) {
    const h = hunk as Record<string, unknown>
    const lines = h.lines
    if (!Array.isArray(lines)) continue
    const oldStart = Number(h.oldStart ?? 0)
    const newStart = Number(h.newStart ?? 0)
    const oldLines = Number(h.oldLines ?? 0)
    const newLines = Number(h.newLines ?? 0)
    parts.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`)
    for (const line of lines) {
      if (typeof line === 'string') parts.push(line)
    }
  }
  return parts.length ? parts.join('\n') : null
}

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

function clipBlock(
  labelKey: BlockLabelKey,
  variant: DetailVariant,
  text: string,
  maxLines: number
): DetailBlock {
  const lines = text.split('\n')
  if (lines.length <= maxLines) {
    return { labelKey, variant, text }
  }
  return {
    labelKey,
    variant,
    text: lines.slice(0, maxLines).join('\n'),
    truncated: { shownLines: maxLines, totalLines: lines.length },
  }
}

/**
 * Remove harness-injected sections from a user prompt so the Timeline
 * summary reflects what the human actually typed. The tags below are
 * appended by Claude Code hooks, slash commands, or SessionStart.
 */
function stripInjectedTags(s: string): string {
  return s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, '')
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, '')
}

function clip(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 1) + '…'
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
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

function getAny(source: unknown, key: string): unknown {
  if (source && typeof source === 'object') {
    return (source as Record<string, unknown>)[key]
  }
  return undefined
}

function getNumber(source: unknown, key: string): number | null {
  if (source && typeof source === 'object') {
    const val = (source as Record<string, unknown>)[key]
    if (typeof val === 'number' && Number.isFinite(val)) return val
  }
  return null
}

/** Try a set of keys on `source`; return the first value that is a string[]. */
function extractListOfStrings(
  source: unknown,
  keys: string[]
): string[] | null {
  if (!source || typeof source !== 'object') return null
  const rec = source as Record<string, unknown>
  for (const k of keys) {
    const v = rec[k]
    if (Array.isArray(v) && v.every(x => typeof x === 'string')) {
      return v as string[]
    }
  }
  return null
}
