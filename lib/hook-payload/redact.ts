import { createHash } from 'crypto'
import type { HookEventType } from '@prisma/client'
import { isTestFilePath } from '../../shared/src/test-file-path'

/**
 * Customer-code redaction for stored hook events in USED_UP workspaces
 * (LUM-855; allowlist since LUM-873).
 *
 * Hook payloads carry the customer's source: Write/Edit bodies, Read file
 * contents, Bash output and heredocs, MCP patches. The analysis we run on the
 * stored rows needs paths, commands and sizes — not the code — so
 * `tool_input` / `tool_response` are reduced to an ALLOWLIST: metadata strings
 * (paths, URLs, search patterns, enums, ids — {@link METADATA_KEYS}), every
 * number / boolean / null, and a summary of the Bash `command`. Every other
 * string — including the keys of tools we have never seen — is replaced by its
 * `{ bytes, lines, sha256 }` under a top-level `_lumo_redacted` map keyed by
 * dot path. The full payload still reaches the in-request side effects
 * (boundary detection, secret scanning, attribution signals, Bash
 * classification) in memory; only the persisted copy is reduced.
 *
 * One deliberate exception: edits to test files keep their whole tool_input
 * and structuredPatch. Test-tampering crossings are adjudicated on exactly that
 * diff, and the reviewer reads it back from the stored event.
 *
 * Conversation text — the top-level `prompt` / `last_assistant_message`, a
 * Task / Agent / WebFetch `tool_input.prompt` and TodoWrite item text — is not
 * repository content and is kept: turn, session and run summaries are built
 * from it ({@link CONVERSATION_INPUT_PATHS}).
 */

export const REDACTED_FIELD = '_lumo_redacted'

/** Failure error text kept on failure events (session failure aggregation). */
export const FAILURE_ERROR_CAP = 2_000

/** Longest Bash command summary stored (heredoc bodies already dropped). */
export const COMMAND_SUMMARY_CAP = 500

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

/**
 * String keys of tool_input / tool_response kept verbatim, at any depth:
 * paths and URLs, search patterns, enum-like modes and states, ids. None of
 * them carries file content. Anything not listed is stripped.
 */
const METADATA_KEYS = new Set([
  // where
  'file_path',
  'filePath',
  'notebook_path',
  'path',
  'url',
  // what was searched for (Grep / Glob)
  'pattern',
  'glob',
  // enums and short labels
  'type',
  'mode',
  'output_mode',
  'edit_mode',
  'cell_type',
  'language',
  'subagent_type',
  'description',
  'skill',
  'model',
  'status',
  'codeText',
  'returnCodeInterpretation',
  'service_tier',
  // ids
  'id',
  'cell_id',
  'agentId',
  'agent_id',
  'tool_use_id',
  'shell_id',
  'bash_id',
  'backgroundTaskId',
])

/** Keys whose value is a list of paths (Glob / Grep files_with_matches, MCP
 *  multi-file reads), kept when every item is a string. */
const PATH_LIST_KEYS = new Set(['filenames', 'files', 'paths'])

/**
 * Conversation text inside tool_input (dot path relative to tool_input): the
 * Task / Agent / WebFetch prompt and TodoWrite item text. Kept — the summaries
 * read them; whether a used-up workspace should drop them too is open (LUM-873).
 */
const CONVERSATION_INPUT_PATHS: readonly RegExp[] = [
  /^prompt$/,
  /^todos\.\d+\.(?:content|activeForm)$/,
]

/** Error-bearing keys kept (capped) on failure events. */
const FAILURE_ERROR_KEYS = new Set(['error', 'stderr', 'message'])

const FAILURE_TYPES: ReadonlySet<HookEventType> = new Set<HookEventType>([
  'POST_TOOL_USE_FAILURE',
])

/** Size + fingerprint recorded in place of content that is not retained. */
export function statsOf(text: string): RedactedStats {
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

/** `<<EOF`, `<<-EOF`, `<<'EOF'`, `<<"EOF"` — not a `<<<` here-string. */
const HEREDOC_INTRO = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_]\w*)\1/

/**
 * What a used-up workspace stores of a Bash command: heredoc bodies (the usual
 * way an agent writes a file through the shell) collapse to one `…` line —
 * the intro and closing delimiter stay, so the command still reads as what it
 * did — and the result is capped at {@link COMMAND_SUMMARY_CAP} characters.
 * Idempotent: summarizing a summary returns it unchanged, so re-running the
 * strip over a stored row (the backfill) never loses the original's stats.
 */
export function summarizeCommand(command: string): string {
  const out: string[] = []
  let delimiter: string | null = null
  let bodyLines = 0
  for (const line of command.split('\n')) {
    if (delimiter !== null) {
      if (line.trim() === delimiter) {
        if (bodyLines > 0) out.push('…')
        out.push(line)
        delimiter = null
      } else {
        bodyLines++
      }
      continue
    }
    out.push(line)
    const m = line.match(HEREDOC_INTRO)
    if (m) {
      delimiter = m[2] as string
      bodyLines = 0
    }
  }
  // An unterminated heredoc still drops its body.
  if (delimiter !== null && bodyLines > 0) out.push('…')
  const summary = out.join('\n')
  return summary.length > COMMAND_SUMMARY_CAP
    ? `${summary.slice(0, COMMAND_SUMMARY_CAP - 1)}…`
    : summary
}

/** True when the stored payload's `tool_input.command` is a summary (LUM-873)
 *  rather than the command the agent ran. */
export function isCommandSummarized(payload: unknown): boolean {
  return readRedactedStats(payload, 'tool_input.command') !== null
}

interface WalkOptions {
  side: 'input' | 'response'
  out: Record<string, RedactedEntry>
  /** Path prefix of the walked root (`tool_input`, `tool_calls.0.tool_response`). */
  root: string
  keepPatch: boolean
  failure: boolean
}

/**
 * Reduce one tool_input / tool_response value to the allowlist. Returns
 * undefined for a value that is dropped (its stats are recorded in `out`).
 * `key` is the object key holding `value` (null for an array item or the root).
 */
function allowlist(
  value: unknown,
  path: string,
  key: string | null,
  parentKey: string | null,
  opts: WalkOptions
): unknown {
  const rel = path === opts.root ? '' : path.slice(opts.root.length + 1)
  if (typeof value === 'string') {
    if (opts.side === 'input') {
      if (rel === 'command') {
        const summary = summarizeCommand(value)
        if (summary !== value) opts.out[path] = statsOf(value)
        return summary
      }
      if (CONVERSATION_INPUT_PATHS.some(re => re.test(rel))) return value
    }
    if (key !== null && METADATA_KEYS.has(key)) return value
    if (key === null && parentKey !== null && PATH_LIST_KEYS.has(parentKey))
      return value
    // On a failure event the error text is what failure aggregation groups
    // on — kept (capped), whether it sits under an error key or IS the whole
    // tool_response (never an item of some array inside it).
    if (
      opts.side === 'response' &&
      opts.failure &&
      (rel === '' || (key !== null && FAILURE_ERROR_KEYS.has(key)))
    ) {
      return value.slice(0, FAILURE_ERROR_CAP)
    }
    opts.out[path] = statsOf(value)
    return undefined
  }
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    if (opts.side === 'response' && key === 'structuredPatch') {
      if (opts.keepPatch) return value
      opts.out[path] = patchStatsOf(value)
      return undefined
    }
    const next: unknown[] = []
    value.forEach((item, i) => {
      const child = allowlist(item, join(path, i), null, key, opts)
      if (child !== undefined) next.push(child)
    })
    return next
  }
  const next: Record<string, unknown> = {}
  for (const [childKey, item] of Object.entries(value)) {
    const child = allowlist(item, join(path, childKey), childKey, key, opts)
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
    const root = join(prefix, 'tool_input')
    const input = allowlist(call.tool_input, root, null, null, {
      side: 'input',
      out,
      root,
      keepPatch: false,
      failure,
    })
    if (input === undefined) delete next.tool_input
    else next.tool_input = input
  }
  if ('tool_response' in call) {
    const root = join(prefix, 'tool_response')
    const response = allowlist(call.tool_response, root, null, null, {
      side: 'response',
      out,
      root,
      keepPatch: keepCode,
      failure,
    })
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
 * `tool_input.command` is the one field that is still there: its stats
 * describe the full command and the stored string is its summary.
 */
export function readRedactedStats(
  payload: unknown,
  path: string
): RedactedStats | null {
  const entry = readEntry(payload, path)
  return entry && 'bytes' in entry ? entry : null
}

/** Combined size of every redacted field at or under one dot path. */
export interface RedactedSize {
  bytes: number
  lines: number
}

/**
 * Total size of the content redacted at `prefix` or anywhere beneath it (e.g.
 * `tool_input.edits` sums every MultiEdit `edits.N.old_string/new_string`;
 * `tool_response` sums a nested MCP / Task / WebFetch response). Null when
 * nothing under `prefix` was redacted — a fully recorded payload has no stats.
 */
export function sumRedactedStats(
  payload: unknown,
  prefix: string
): RedactedSize | null {
  if (!isPlainObject(payload)) return null
  const map = payload[REDACTED_FIELD]
  if (!isPlainObject(map)) return null
  let found = false
  let bytes = 0
  let lines = 0
  for (const [path, entry] of Object.entries(map)) {
    if (path !== prefix && !path.startsWith(`${prefix}.`)) continue
    if (!isPlainObject(entry) || typeof entry.bytes !== 'number') continue
    found = true
    bytes += entry.bytes
    lines += typeof entry.lines === 'number' ? entry.lines : 0
  }
  return found ? { bytes, lines } : null
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
