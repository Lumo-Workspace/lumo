import type { HookEventType } from '@prisma/client'

/**
 * How many same-type failures in one Claude Code session count as "stuck".
 * LUM-153 introduced it as the (now-removed) blocked-tag prompt threshold; LUM-544
 * reuses it as the server-side auto-block threshold (autoBlockService). Same
 * error ≥3 times. Borrows the "named threshold constant" style of
 * lib/summaries/risk.ts but is a separate concern (session diagnostics).
 */
export const FAILURE_PROMPT_THRESHOLD = 3

/** Max characters of error text surfaced in a failure summary (terminal-friendly). */
const SUMMARY_MAX = 160

/**
 * A failure HookEvent row, narrowed to the fields the aggregator reads.
 * Sourced from hookEventRepository.findFailuresBySession.
 */
export interface SessionFailureRow {
  type: HookEventType
  toolName: string | null
  turnSummary: string | null
  payload: unknown
  createdAt: Date
}

/** The dominant failure group surfaced to the wrap prompt. */
export interface TopFailureGroup {
  /** Human label for the prompt: the tool name, or "turn-level failures" for turn-level. */
  label: string
  /** Number of failures in this group. */
  count: number
  /** Best-effort one-line error text from the group's most recent failure. */
  lastErrorSummary: string | null
}

/**
 * Classify a failure row into a grouping key. POST_TOOL_USE_FAILURE groups by
 * tool (so "Bash failed 3×" is distinct from "Edit failed 3×"); STOP_FAILURE
 * is turn-level and has no tool, so all turn failures share one key.
 */
function classify(row: SessionFailureRow): { key: string; label: string } {
  if (row.type === 'STOP_FAILURE') {
    return { key: 'turn', label: 'turn-level failures' }
  }
  const tool = row.toolName ?? 'unknown'
  return { key: `tool:${tool}`, label: row.toolName ?? 'unknown tool' }
}

function truncate(s: string): string {
  const trimmed = s.trim()
  return trimmed.length > SUMMARY_MAX
    ? `${trimmed.slice(0, SUMMARY_MAX - 1)}…`
    : trimmed
}

/**
 * Best-effort one-line error text for a failure row. STOP_FAILURE rows carry a
 * clean LLM `turnSummary`; POST_TOOL_USE_FAILURE rows don't, so dig the raw
 * payload for the usual error-bearing fields. Returns null when nothing usable.
 */
export function extractErrorSummary(row: SessionFailureRow): string | null {
  if (typeof row.turnSummary === 'string' && row.turnSummary.trim()) {
    return truncate(row.turnSummary)
  }
  const found = digPayloadError(row.payload)
  return found ? truncate(found) : null
}

function digPayloadError(payload: unknown): string | null {
  if (typeof payload === 'string') return payload.trim() || null
  if (!payload || typeof payload !== 'object') return null
  const obj = payload as Record<string, unknown>
  // Priority: tool_response (where Bash/Edit failures land), then common
  // top-level error fields.
  return (
    pickString(obj.tool_response) ??
    pickString(obj.error) ??
    pickString(obj.stderr) ??
    pickString(obj.message)
  )
}

/** Pull a usable string out of a value that may be a string or an object. */
function pickString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const field of ['stderr', 'error', 'message', 'content', 'output']) {
      const v = obj[field]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  return null
}

/**
 * Reduce a session's failure events to the single dominant failure group, or
 * null when there are no failures. The caller compares `count` against
 * FAILURE_PROMPT_THRESHOLD to decide whether to prompt. Pure — no I/O, no
 * clock; "most recent" is derived from the rows' own createdAt.
 *
 * Tie-break: when two groups have equal counts, the one whose most-recent
 * failure is newest wins (it's the more "currently stuck" signal).
 */
export function aggregateSessionFailures(
  rows: SessionFailureRow[]
): TopFailureGroup | null {
  if (rows.length === 0) return null

  interface Bucket {
    label: string
    rows: SessionFailureRow[]
    newest: Date
  }
  const buckets = new Map<string, Bucket>()

  for (const row of rows) {
    const { key, label } = classify(row)
    const existing = buckets.get(key)
    if (existing) {
      existing.rows.push(row)
      if (row.createdAt > existing.newest) existing.newest = row.createdAt
    } else {
      buckets.set(key, { label, rows: [row], newest: row.createdAt })
    }
  }

  let top: Bucket | null = null
  for (const bucket of buckets.values()) {
    if (
      top === null ||
      bucket.rows.length > top.rows.length ||
      (bucket.rows.length === top.rows.length && bucket.newest > top.newest)
    ) {
      top = bucket
    }
  }
  if (top === null) return null

  // Most recent row in the winning group drives the error summary.
  const mostRecent = top.rows.reduce((a, b) =>
    b.createdAt > a.createdAt ? b : a
  )
  return {
    label: top.label,
    count: top.rows.length,
    lastErrorSummary: extractErrorSummary(mostRecent),
  }
}
