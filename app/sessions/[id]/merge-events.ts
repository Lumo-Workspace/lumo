/**
 * Merge raw HookEvent rows into user-facing timeline items.
 *
 * A "tool call" is the Pre+Post pair sharing a tool_use_id. STOP events and
 * orphans (Pre without Post, or Post without Pre) each get their own item.
 *
 * Pure: no React, no Prisma, no I/O — trivially unit-testable.
 */

import { isPrunedPayload } from '@/lib/hook-event/retention'
import {
  readRedactedPatch,
  readRedactedStats,
  type RedactedPatchStats,
  type RedactedStats,
} from '@/lib/hook-payload/redact'

/** Row text for an event whose payload the retention sweep cleared (LUM-859). */
export const PRUNED_SUMMARY = 'Content cleared per retention policy'

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
  label: string
  variant: DetailVariant
  text: string
  truncated?: { shownLines: number; totalLines: number }
  /** Set on a `redacted` block (LUM-855): the size of content Lumo did not
   *  keep. `text` is empty — the view renders the not-retained notice. */
  redacted?: { lines: number; bytes: number }
}

export type ItemStatus = 'ok' | 'error' | 'pending'

export interface TimelineItem {
  key: string
  kind: 'tool' | 'stop' | 'orphan' | 'user-prompt'
  toolName: string | null
  /** One-line description shown when collapsed. */
  summary: string
  /** Short trailing badge, e.g. "+12 -3" or "✓ 23 passed". Optional. */
  badge: string | null
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
    summary: PRUNED_SUMMARY,
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

  const summary = cleaned ? clip(cleaned, 100) : '(empty prompt)'
  const details: DetailBlock[] = []
  if (cleaned) {
    details.push({ label: 'prompt', variant: 'text', text: cleaned })
  }
  if (rawPrompt && stripped !== rawPrompt) {
    details.push({
      label: 'raw (with injected context)',
      variant: 'text',
      text: rawPrompt,
    })
  }

  return {
    key: ev.id,
    kind: 'user-prompt',
    toolName: null,
    summary,
    badge: null,
    status: 'ok',
    startAt: ev.createdAt,
    endAt: ev.createdAt,
    details,
  }
}

function stopItem(ev: RawEvent): TimelineItem {
  const last = getString(ev.payload, 'last_assistant_message')
  const summary = last ? clip(last, 100) : 'model stopped'
  const details: DetailBlock[] = last
    ? [{ label: 'last message', variant: 'text', text: last }]
    : []
  return {
    key: ev.id,
    kind: 'stop',
    toolName: null,
    summary,
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

  const { summary, badge, status, details } = formatTool(
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
}

const NO_REDACTION: RedactionLookup = { stats: () => null, patch: () => null }

function redactionLookup(anchor: unknown, post: unknown): RedactionLookup {
  return {
    stats: path =>
      readRedactedStats(post, path) ?? readRedactedStats(anchor, path),
    patch: path =>
      readRedactedPatch(post, path) ?? readRedactedPatch(anchor, path),
  }
}

function redactedBlock(
  label: string,
  stats: RedactedStats | null
): DetailBlock | null {
  if (!stats) return null
  return {
    label,
    variant: 'redacted',
    text: '',
    redacted: { lines: stats.lines, bytes: stats.bytes },
  }
}

function pushBlock(details: DetailBlock[], block: DetailBlock | null) {
  if (block) details.push(block)
}

interface FormatResult {
  summary: string
  badge: string | null
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
  details.push({ label: 'command', variant: 'code', text: command })
  if (stdout.trim()) details.push(clipBlock('stdout', 'code', stdout, 40))
  if (stderr.trim()) details.push(clipBlock('stderr', 'error', stderr, 40))
  pushBlock(
    details,
    redactedBlock('stdout', redaction.stats('tool_response.stdout'))
  )
  const redactedStderr = redaction.stats('tool_response.stderr')
  pushBlock(details, redactedBlock('stderr', redactedStderr))
  if (interrupted)
    details.push({ label: 'status', variant: 'error', text: 'interrupted' })

  const summary = clip(command.replace(/\s+/g, ' '), 100)
  const hasStderr = stderr.trim() !== '' || (redactedStderr?.bytes ?? 0) > 0
  const badge = interrupted ? 'interrupted' : hasStderr ? 'stderr' : null

  return { summary, badge, status, details }
}

function formatRead(
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  status: ItemStatus,
  redaction: RedactionLookup
): FormatResult {
  const path = getString(input, 'file_path') ?? '(no path)'
  const file = getRecord(response, 'file')
  const content = getString(file, 'content') ?? ''
  const redacted = redaction.stats('tool_response.file.content')
  const totalLines = content
    ? content.split('\n').length
    : (redacted?.lines ?? 0)
  const details: DetailBlock[] = []
  if (content) details.push(clipBlock('content', 'code', content, 30))
  pushBlock(details, redactedBlock('content', redacted))

  const badge = totalLines > 0 ? `${totalLines} lines` : null
  return { summary: path, badge, status, details }
}

function formatEdit(
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  status: ItemStatus,
  redaction: RedactionLookup
): FormatResult {
  const path =
    getString(input, 'file_path') ??
    getString(response, 'filePath') ??
    '(no path)'

  const patch = renderStructuredPatch(getAny(response, 'structuredPatch'))
  const oldStr = getString(input, 'old_string') ?? ''
  const newStr = getString(input, 'new_string') ?? ''

  const details: DetailBlock[] = []
  if (patch) {
    details.push(clipBlock('diff', 'diff', patch, 60))
  } else if (oldStr || newStr) {
    if (oldStr) details.push(clipBlock('old', 'code', oldStr, 20))
    if (newStr) details.push(clipBlock('new', 'code', newStr, 20))
  } else {
    pushBlock(
      details,
      redactedBlock(
        'diff',
        redaction.stats('tool_input.new_string') ??
          redaction.stats('tool_input.old_string')
      )
    )
  }

  const changes =
    countPatchChanges(getAny(response, 'structuredPatch')) ??
    redaction.patch('tool_response.structuredPatch')
  const badge =
    changes && (changes.added || changes.removed)
      ? `+${changes.added} -${changes.removed}`
      : null

  return { summary: path, badge, status, details }
}

function formatWrite(
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  status: ItemStatus,
  redaction: RedactionLookup
): FormatResult {
  const path =
    getString(input, 'file_path') ??
    getString(response, 'filePath') ??
    '(no path)'
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
  const badge = totalLines > 0 ? `${kind} · ${totalLines} lines` : kind
  return { summary: path, badge, status, details }
}

function formatGrep(
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  status: ItemStatus,
  redaction: RedactionLookup
): FormatResult {
  const pattern = getString(input, 'pattern') ?? ''
  const path = getString(input, 'path')
  const summary = path ? `${pattern}  in ${path}` : pattern

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
      label: 'response',
      variant: 'json',
      text: stringifyJson(response),
    })
  }

  // Badge: prefer the count the mode actually populates.
  const badge =
    mode === 'files_with_matches' && numFiles !== null
      ? numFiles === 0
        ? 'no match'
        : `${numFiles} files`
      : mode === 'content' && numLines !== null
        ? numLines === 0
          ? 'no match'
          : `${numLines} lines`
        : mode === 'count' && numMatches !== null
          ? `${numMatches} matches`
          : numFiles !== null
            ? `${numFiles} files`
            : null

  return { summary, badge, status, details }
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
      label: 'response',
      variant: 'json',
      text: stringifyJson(response),
    })
  }

  const badge =
    numFiles !== null
      ? `${numFiles} files`
      : files
        ? `${files.length} files`
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
  const summary = `${todos.length} todos`
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
  return { summary, badge: null, status, details }
}

function formatFallback(
  input: Record<string, unknown> | null,
  response: Record<string, unknown> | null,
  status: ItemStatus,
  redaction: RedactionLookup
): FormatResult {
  const summary = input
    ? clip(stringifyJson(input).slice(1, -1), 100)
    : '(no input)'
  const details: DetailBlock[] = []
  if (input)
    details.push({
      label: 'input',
      variant: 'json',
      text: stringifyJson(input),
    })
  if (response)
    details.push({
      label: 'response',
      variant: 'json',
      text: stringifyJson(response),
    })
  pushBlock(
    details,
    redactedBlock('response', redaction.stats('tool_response'))
  )
  return { summary, badge: null, status, details }
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
  label: string,
  variant: DetailVariant,
  text: string,
  maxLines: number
): DetailBlock {
  const lines = text.split('\n')
  if (lines.length <= maxLines) {
    return { label, variant, text }
  }
  return {
    label,
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
