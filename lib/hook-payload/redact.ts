import { createHash } from 'crypto'
import type { HookEventType } from '@prisma/client'
import { isTestFilePath } from '../../shared/src/test-file-path'

/**
 * Customer-code redaction for stored hook events (LUM-855).
 *
 * Hook payloads carry the customer's source: Write/Edit bodies, Read file
 * contents, Bash output. The analysis we run on them needs paths, commands and
 * sizes — not the code — so the stored row keeps those and replaces each
 * code-bearing string with `{ bytes, lines, sha256 }` under a top-level
 * `_lumo_redacted` map keyed by dot path. The full payload still reaches the
 * in-request side effects (boundary detection, secret scanning) in memory; only
 * the persisted copy is redacted.
 *
 * One deliberate exception: edits to test files keep their old/new strings.
 * Test-tampering crossings are adjudicated on exactly that diff, and the
 * reviewer reads it back from the stored event.
 *
 * Prompts and assistant messages are conversation, not repository content, and
 * are left alone (turn and session summaries are built from them).
 */

export const REDACTED_FIELD = '_lumo_redacted'

/** Failure error text kept on failure events (session failure aggregation). */
export const FAILURE_ERROR_CAP = 2_000

export interface RedactedStats {
  bytes: number
  lines: number
  sha256: string
}

export interface RedactedPatchStats {
  added: number
  removed: number
}

type RedactedEntry = RedactedStats | RedactedPatchStats

/** `tool_input` keys that carry file content (Write/Edit/MultiEdit/NotebookEdit
 *  and the str_replace editor variants). */
const INPUT_CODE_KEYS = new Set([
  'content',
  'old_string',
  'new_string',
  'old_str',
  'new_str',
  'new_source',
  'file_text',
])

/** `tool_response` string keys that are metadata, never file content. */
const RESPONSE_METADATA_KEYS = new Set([
  'filePath',
  'file_path',
  'path',
  'type',
  'mode',
  'url',
])

/** `tool_response` array-of-path keys (Glob / Grep files_with_matches). */
const RESPONSE_PATH_LIST_KEYS = new Set(['filenames'])

/** Error-bearing keys kept (capped) on failure events. */
const FAILURE_ERROR_KEYS = new Set(['error', 'stderr', 'message'])

const FAILURE_TYPES: ReadonlySet<HookEventType> = new Set<HookEventType>([
  'POST_TOOL_USE_FAILURE',
])

function statsOf(text: string): RedactedStats {
  return {
    bytes: Buffer.byteLength(text, 'utf8'),
    lines: text.length === 0 ? 0 : text.split('\n').length,
    sha256: createHash('sha256').update(text).digest('hex'),
  }
}

function patchStatsOf(patch: unknown[]): RedactedPatchStats {
  let added = 0
  let removed = 0
  for (const hunk of patch) {
    const lines = (hunk as { lines?: unknown } | null)?.lines
    if (!Array.isArray(lines)) continue
    for (const line of lines) {
      if (typeof line !== 'string') continue
      if (line.startsWith('+')) added++
      else if (line.startsWith('-')) removed++
    }
  }
  return { added, removed }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function join(path: string, key: string | number): string {
  return path ? `${path}.${key}` : String(key)
}

function filePathOf(payload: Record<string, unknown>): string | null {
  const input = payload.tool_input
  if (isPlainObject(input)) {
    for (const key of ['file_path', 'filePath', 'path', 'notebook_path']) {
      if (typeof input[key] === 'string') return input[key] as string
    }
  }
  const response = payload.tool_response
  if (isPlainObject(response) && typeof response.filePath === 'string') {
    return response.filePath
  }
  return null
}

/** Strip code-bearing keys from tool_input (recursing into MultiEdit `edits`). */
function redactInput(
  value: unknown,
  path: string,
  out: Record<string, RedactedEntry>
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, i) => redactInput(item, join(path, i), out))
  }
  if (!isPlainObject(value)) return value
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const childPath = join(path, key)
    if (INPUT_CODE_KEYS.has(key) && typeof item === 'string') {
      out[childPath] = statsOf(item)
      continue
    }
    next[key] = key === 'edits' ? redactInput(item, childPath, out) : item
  }
  return next
}

/**
 * Keep only metadata in tool_response: numbers, booleans, metadata strings and
 * path lists survive; every other string is replaced by its stats. A
 * `structuredPatch` becomes its added/removed counts unless `keepPatch`.
 */
function redactResponse(
  value: unknown,
  path: string,
  out: Record<string, RedactedEntry>,
  opts: { keepPatch: boolean; failure: boolean },
  key: string | null = null
): unknown {
  if (typeof value === 'string') {
    if (key !== null && RESPONSE_METADATA_KEYS.has(key)) return value
    // On a failure event the error text is what failure aggregation groups
    // on — kept (capped), whether it sits under an error key or IS the whole
    // tool_response.
    if (opts.failure && (key === null || FAILURE_ERROR_KEYS.has(key))) {
      return value.slice(0, FAILURE_ERROR_CAP)
    }
    out[path || 'tool_response'] = statsOf(value)
    return undefined
  }
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    if (key === 'structuredPatch') {
      if (opts.keepPatch) return value
      out[path] = patchStatsOf(value)
      return undefined
    }
    if (
      key !== null &&
      RESPONSE_PATH_LIST_KEYS.has(key) &&
      value.every(item => typeof item === 'string')
    ) {
      return value
    }
    const next: unknown[] = []
    value.forEach((item, i) => {
      const child = redactResponse(item, join(path, i), out, opts)
      if (child !== undefined) next.push(child)
    })
    return next
  }
  const next: Record<string, unknown> = {}
  for (const [childKey, item] of Object.entries(value)) {
    const child = redactResponse(
      item,
      join(path, childKey),
      out,
      opts,
      childKey
    )
    if (child !== undefined) next[childKey] = child
  }
  return next
}

/**
 * Strip one tool call — the top-level payload of a Pre/PostToolUse event, or one
 * entry of a PostToolBatch `tool_calls[]` — under `prefix` (dot path).
 */
function stripToolCall(
  call: Record<string, unknown>,
  prefix: string,
  out: Record<string, RedactedEntry>,
  failure: boolean
): Record<string, unknown> {
  const filePath = filePathOf(call)
  const keepCode = filePath !== null && isTestFilePath(filePath)
  const next: Record<string, unknown> = { ...call }

  if ('tool_input' in call && !keepCode) {
    next.tool_input = redactInput(
      call.tool_input,
      join(prefix, 'tool_input'),
      out
    )
  }
  if ('tool_response' in call) {
    const response = redactResponse(
      call.tool_response,
      join(prefix, 'tool_response'),
      out,
      { keepPatch: keepCode, failure }
    )
    if (response === undefined) delete next.tool_response
    else next.tool_response = response
  }
  return next
}

/**
 * Return the copy of a (validated) hook payload that is safe to persist. Never
 * mutates its input. A client-supplied `_lumo_redacted` is always dropped so a
 * stored marker can only originate from the server.
 *
 * PostToolBatch nests every call of the batch under `tool_calls[]`, each with
 * its own tool_input / tool_response — those are stripped by the same rules,
 * per call (a found-in-production leak, LUM-855 TC5).
 */
export function stripCodeFromHookPayload(
  type: HookEventType,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, RedactedEntry> = {}
  const failure = FAILURE_TYPES.has(type)

  const next = stripToolCall(payload, '', out, failure)
  delete next[REDACTED_FIELD]

  if (Array.isArray(payload.tool_calls)) {
    next.tool_calls = payload.tool_calls.map((call, i) => {
      const path = `tool_calls.${i}`
      if (isPlainObject(call)) return stripToolCall(call, path, out, failure)
      if (typeof call === 'string') {
        out[path] = statsOf(call)
        return null
      }
      return call
    })
  }
  if (failure && typeof payload.error === 'string') {
    next.error = payload.error.slice(0, FAILURE_ERROR_CAP)
  }

  if (Object.keys(out).length > 0) next[REDACTED_FIELD] = out
  return next
}

/**
 * Stats for a field the stored payload no longer carries (`path` is the dot
 * path it had, e.g. `tool_input.content`), or null when it was not redacted.
 */
export function readRedactedStats(
  payload: unknown,
  path: string
): RedactedStats | null {
  const entry = readEntry(payload, path)
  return entry && 'bytes' in entry ? entry : null
}

/** Added/removed counts for a redacted `structuredPatch`. */
export function readRedactedPatch(
  payload: unknown,
  path: string
): RedactedPatchStats | null {
  const entry = readEntry(payload, path)
  return entry && 'added' in entry ? entry : null
}

/** True when the stored payload had any content redacted. */
export function hasRedactedContent(payload: unknown): boolean {
  return isPlainObject(payload) && isPlainObject(payload[REDACTED_FIELD])
}

function readEntry(payload: unknown, path: string): RedactedEntry | null {
  if (!isPlainObject(payload)) return null
  const map = payload[REDACTED_FIELD]
  if (!isPlainObject(map)) return null
  const entry = map[path]
  return isPlainObject(entry) ? (entry as unknown as RedactedEntry) : null
}
