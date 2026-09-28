import { z } from 'zod'
import type { HookEventType } from '@prisma/client'
import {
  redactForStorage,
  redactPrivateKeysAcrossParts,
} from '@/lib/security-scan/scan-secrets'

/**
 * Max length for any single string inside a hook payload.
 *
 * Hook payloads are Claude Code hook stdin JSON forwarded verbatim by the CLI
 * and persisted into an unbounded Prisma `Json` column. Free-text carriers
 * (`tool_input.content`, `tool_response`, `last_assistant_message`, `prompt`)
 * have no upstream bound and can reach multiple MB per event. 64k chars keeps
 * every analytical consumer working (file-path extraction, turn summaries,
 * memory extraction read at most the head of these fields) while bounding
 * per-event storage. Enforced as truncate-and-mark, never reject — hooks are
 * best-effort and a 4xx would break the event stream.
 */
export const HOOK_FREE_TEXT_CAP = 64_000

/**
 * Traversal floor for the truncation walk. JSON nesting beyond this depth is
 * not realistic hook traffic; rather than let oversized strings hide below
 * the limit (or risk unbounded recursion), the whole subtree is dropped and
 * marked.
 */
const MAX_TRAVERSAL_DEPTH = 128

/**
 * Fields every Claude Code hook payload may carry. All optional — the schemas
 * assert types when present, never require presence (a payload missing
 * session_id is recorded unlinked, matching existing service tolerance).
 *
 * `_lumo_validation` (this module's marker), `_lumo_context_metrics`
 * (session-start injection telemetry, LUM-402), `_lumo_redaction` (storage
 * redaction marker) and `_lumo_pruned` (retention-sweep marker, LUM-859) are
 * server-side keys and are reserved: a client-supplied value is always dropped
 * so a stored marker can only originate from the server.
 */
const commonFields = {
  session_id: z.string().optional(),
  cwd: z.string().optional(),
  transcript_path: z.string().optional(),
  hook_event_name: z.string().optional(),
  permission_mode: z.string().optional(),
  _lumo_usage: z.looseObject({}).optional(),
  _lumo_validation: z.never().optional(),
  _lumo_context_metrics: z.never().optional(),
  _lumo_redaction: z.never().optional(),
  _lumo_pruned: z.never().optional(),
}

const toolFields = {
  tool_name: z.string().optional(),
  tool_use_id: z.string().optional(),
  // tool_response is intentionally unconstrained: Claude Code emits objects,
  // arrays, and bare strings depending on the tool. tool_input is always an
  // object when present.
  tool_input: z.looseObject({}).optional(),
}

const base = z.looseObject({ ...commonFields })
const toolEvent = z.looseObject({ ...commonFields, ...toolFields })
const stopEvent = z.looseObject({
  ...commonFields,
  stop_hook_active: z.boolean().optional(),
  last_assistant_message: z.string().optional(),
})
const promptEvent = z.looseObject({
  ...commonFields,
  prompt: z.string().optional(),
})
const fileEvent = z.looseObject({
  ...commonFields,
  path: z.string().optional(),
  file_path: z.string().optional(),
})
const worktreeEvent = z.looseObject({
  ...commonFields,
  worktree_path: z.string().optional(),
  branch: z.string().optional(),
})

/**
 * Top-level payload schema per hook event type, executed by the hook handler
 * (`app/api/hooks/_handler.ts`) before anything is persisted. Loose objects:
 * unknown fields pass through untouched, known fields are type-asserted.
 * The `Record<HookEventType, …>` type makes a missing entry a compile error
 * when a new enum value lands.
 */
export const HOOK_PAYLOAD_SCHEMAS: Record<HookEventType, z.ZodType> = {
  PRE_TOOL_USE: toolEvent,
  POST_TOOL_USE: toolEvent,
  POST_TOOL_USE_FAILURE: toolEvent,
  POST_TOOL_BATCH: toolEvent,
  PERMISSION_REQUEST: toolEvent,
  PERMISSION_DENIED: toolEvent,
  STOP: stopEvent,
  STOP_FAILURE: stopEvent,
  USER_PROMPT_SUBMIT: promptEvent,
  USER_PROMPT_EXPANSION: promptEvent,
  SESSION_START: z.looseObject({
    ...commonFields,
    source: z.string().optional(),
  }),
  SESSION_END: z.looseObject({
    ...commonFields,
    reason: z.string().optional(),
  }),
  SUBAGENT_START: base,
  SUBAGENT_STOP: base,
  WORKTREE_CREATE: worktreeEvent,
  WORKTREE_REMOVE: worktreeEvent,
  FILE_CHANGED: fileEvent,
  CONFIG_CHANGE: fileEvent,
  INSTRUCTIONS_LOADED: fileEvent,
  TASK_CREATED: base,
  TASK_COMPLETED: base,
  NOTIFICATION: z.looseObject({
    ...commonFields,
    message: z.string().optional(),
  }),
  ELICITATION: base,
  ELICITATION_RESULT: base,
  CWD_CHANGED: base,
}

export interface HookPayloadValidationResult {
  /**
   * Payload safe to persist. The original reference when nothing was
   * modified; otherwise a copy carrying a `_lumo_validation` marker
   * (`{ truncated?: string[], dropped?: string[] }` of dot paths).
   */
  payload: Record<string, unknown>
  /** Dot paths of strings cut to HOOK_FREE_TEXT_CAP (or subtrees dropped at
   *  the traversal depth floor). */
  truncated: string[]
  /** Top-level keys removed because they failed their type assertion, or
   *  `$root` when the body itself was not a JSON object. */
  dropped: string[]
  modified: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function truncateDeep(
  value: unknown,
  path: string,
  truncated: string[],
  depth: number
): unknown {
  if (typeof value === 'string') {
    if (value.length > HOOK_FREE_TEXT_CAP) {
      truncated.push(path)
      return value.slice(0, HOOK_FREE_TEXT_CAP)
    }
    return value
  }
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_TRAVERSAL_DEPTH) {
    truncated.push(path)
    return null
  }
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item, index) => {
      const child = truncateDeep(
        item,
        path ? `${path}.${index}` : String(index),
        truncated,
        depth + 1
      )
      if (child !== item) changed = true
      return child
    })
    return changed ? next : value
  }
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const child = truncateDeep(
      item,
      path ? `${path}.${key}` : key,
      truncated,
      depth + 1
    )
    if (child !== item) changed = true
    next[key] = child
  }
  return changed ? next : value
}

/**
 * Validate a hook payload at the POST boundary: assert key-field types via
 * the per-type schema (offending top-level fields are dropped, not rejected),
 * cap every string at HOOK_FREE_TEXT_CAP (truncated, not rejected), and stamp
 * a `_lumo_validation` marker on the stored payload when anything changed.
 *
 * Never throws and never produces a 4xx-worthy outcome — hooks are
 * best-effort, so malformed input degrades to a marked, persistable payload
 * instead of breaking the event stream.
 */
export function validateHookPayload(
  type: HookEventType,
  raw: unknown
): HookPayloadValidationResult {
  if (!isPlainObject(raw)) {
    const dropped = ['$root']
    return {
      payload: { _lumo_validation: { dropped } },
      truncated: [],
      dropped,
      modified: true,
    }
  }

  const dropped: string[] = []
  let working: Record<string, unknown> = raw
  const parsed = HOOK_PAYLOAD_SCHEMAS[type].safeParse(raw)
  if (!parsed.success) {
    const badKeys = new Set<string>()
    for (const issue of parsed.error.issues) {
      const head = issue.path[0]
      if (typeof head === 'string') badKeys.add(head)
    }
    if (badKeys.size > 0) {
      working = { ...raw }
      for (const key of badKeys) {
        delete working[key]
        dropped.push(key)
      }
    }
  }

  const truncated: string[] = []
  const capped = truncateDeep(working, '', truncated, 0) as Record<
    string,
    unknown
  >

  if (dropped.length === 0 && truncated.length === 0) {
    return { payload: raw, truncated, dropped, modified: false }
  }

  // `capped` is always our own copy here: drops shallow-copied `working`, and
  // any truncation rebuilds every object on the changed path including the
  // root — so stamping the marker never mutates the caller's object.
  capped['_lumo_validation'] = {
    ...(truncated.length > 0 ? { truncated } : {}),
    ...(dropped.length > 0 ? { dropped } : {}),
  }
  return { payload: capped, truncated, dropped, modified: true }
}

export interface HookPayloadRedactionResult {
  /** Payload safe to persist: the original reference when nothing matched,
   *  otherwise a copy carrying a `_lumo_redaction: { count }` marker. */
  payload: Record<string, unknown>
  /** Distinct credential values redacted, summed over every string. */
  redactedCount: number
}

function redactDeep(value: unknown, counter: { n: number }): unknown {
  if (typeof value === 'string') {
    const { text, redactedCount } = redactForStorage(value)
    counter.n += redactedCount
    return text
  }
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const joined = joinKeyLines(value, counter)
    let changed = joined !== value
    const next = joined.map(item => {
      const child = redactDeep(item, counter)
      if (child !== item) changed = true
      return child
    })
    return changed ? next : value
  }
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const child = redactDeep(item, counter)
    if (child !== item) changed = true
    next[key] = child
  }
  return changed ? next : value
}

/**
 * LUM-894 — a key split one line per element (a kept test-file
 * `structuredPatch` hunk, a JSON array of lines) is redacted over the joined
 * string elements; the array comes back as-is when no key spans them.
 */
function joinKeyLines(value: unknown[], counter: { n: number }): unknown[] {
  const at: number[] = []
  const parts: string[] = []
  value.forEach((item, i) => {
    if (typeof item === 'string') {
      at.push(i)
      parts.push(item)
    }
  })
  const { parts: redacted, count } = redactPrivateKeysAcrossParts(parts)
  if (count === 0) return value
  counter.n += count
  const next = [...value]
  at.forEach((index, k) => {
    next[index] = redacted[k]
  })
  return next
}

/**
 * LUM-859 — redact credentials out of a (validated) hook payload before it is
 * persisted. Every string at every depth runs through the secret registry
 * (`redactForStorage`: nothing dropped, secret-free text returned as-is).
 *
 * Applies ONLY to the copy that is stored. The in-memory payload stays raw for
 * the boundary detector — HARDCODED_SECRET and friends need the original text
 * — which is why the hook handler keeps both.
 */
export function redactHookPayload(
  payload: Record<string, unknown>
): HookPayloadRedactionResult {
  const counter = { n: 0 }
  const redacted = redactDeep(payload, counter) as Record<string, unknown>
  if (redacted === payload) return { payload, redactedCount: 0 }
  // `redacted` is our own copy (every object on a changed path is rebuilt,
  // including the root), so stamping the marker never mutates the caller's.
  redacted['_lumo_redaction'] = { count: counter.n }
  return { payload: redacted, redactedCount: counter.n }
}
