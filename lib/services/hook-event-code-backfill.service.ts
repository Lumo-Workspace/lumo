import type { HookEventType, Prisma } from '@prisma/client'
import {
  hookEventCodeBackfillRepository,
  type PayloadRewrite,
} from '@/lib/repositories/hook-event-code-backfill.repository'
import { redactHookPayload } from '@/lib/validation/hook-payload'
import {
  FAILURE_ERROR_CAP,
  REDACTED_FIELD,
  statsOf,
  stripCodeFromHookPayload,
} from '@/lib/hook-payload/redact'
import { isPrunedPayload } from '@/lib/hook-event/retention'

/**
 * LUM-855 backfill — bring HookEvent rows stored before the ingest-time
 * redaction (LUM-859 credentials, LUM-855 customer code) to the shape a new
 * row gets today. Rows a boundary crossing references are skipped: the
 * crossing re-judge reads their original text.
 */

/** JSON with object keys sorted at every level. Postgres jsonb reorders keys,
 *  so a plain JSON.stringify comparison would flag clean rows as changed. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0
          )
        )
      : v
  )
}

export interface StoredPayloadRewrite {
  payload: Record<string, unknown>
  /** Credentials replaced in this pass (0 when only code was stripped). */
  secrets: number
  bytesBefore: number
  bytesAfter: number
}

/**
 * The payload a stored row should hold, or null when it already matches.
 * Idempotent: an already-stripped row keeps its `_lumo_redacted` stats (the
 * ingest path drops an incoming marker as client-forged; here it is our own).
 */
export function rewriteStoredPayload(
  type: HookEventType,
  stored: Prisma.JsonValue
): StoredPayloadRewrite | null {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored))
    return null
  if (isPrunedPayload(stored)) return null
  const payload = stored as Record<string, unknown>

  const redacted = redactHookPayload(payload)
  const next = stripCodeFromHookPayload(type, redacted.payload)
  const existing = payload[REDACTED_FIELD]
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    next[REDACTED_FIELD] = {
      ...(existing as Record<string, unknown>),
      ...((next[REDACTED_FIELD] as Record<string, unknown> | undefined) ?? {}),
    }
  }

  const before = canonicalJson(payload)
  const after = canonicalJson(next)
  if (before === after) return null
  return {
    payload: next,
    secrets: redacted.redactedCount,
    bytesBefore: before.length,
    bytesAfter: after.length,
  }
}

/** Shell output keys on a Bash tool_response. */
const SHELL_OUTPUT_KEYS = ['stdout', 'stderr'] as const

/**
 * Strip one tool_response of a crossing-referenced event: `originalFile` (the
 * whole pre-edit file) and Bash `stdout` / `stderr` go, their stats recorded
 * under `prefix.<key>`. On a failure event the shell output is the error that
 * failure aggregation groups on, so it is capped instead (same rule as ingest).
 */
function stripCrossingResponse(
  response: unknown,
  prefix: string,
  marker: Record<string, unknown>,
  failure: boolean
): unknown {
  if (!response || typeof response !== 'object' || Array.isArray(response))
    return response
  const next = { ...(response as Record<string, unknown>) }
  if (typeof next.originalFile === 'string') {
    marker[`${prefix}.originalFile`] = statsOf(next.originalFile)
    delete next.originalFile
  }
  for (const key of SHELL_OUTPUT_KEYS) {
    const value = next[key]
    if (typeof value !== 'string') continue
    if (failure) {
      next[key] = value.slice(0, FAILURE_ERROR_CAP)
    } else {
      marker[`${prefix}.${key}`] = statsOf(value)
      delete next[key]
    }
  }
  return next
}

/**
 * The payload a crossing-referenced event should hold, or null when it already
 * matches. These rows keep their tool_input — the crossing panel renders a
 * TEST_TAMPERING edit from it — but get credential redaction (LUM-859) and
 * lose `tool_response.originalFile` and Bash stdout/stderr, which no crossing
 * surface reads (see stripCrossingResponse).
 */
export function rewriteCrossingPayload(
  type: HookEventType,
  stored: Prisma.JsonValue
): StoredPayloadRewrite | null {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored))
    return null
  if (isPrunedPayload(stored)) return null
  const payload = stored as Record<string, unknown>

  const redacted = redactHookPayload(payload)
  const next: Record<string, unknown> = { ...redacted.payload }
  const existing = payload[REDACTED_FIELD]
  const marker: Record<string, unknown> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {}

  const failure = type === 'POST_TOOL_USE_FAILURE'
  if ('tool_response' in next) {
    next.tool_response = stripCrossingResponse(
      next.tool_response,
      'tool_response',
      marker,
      failure
    )
  }
  if (Array.isArray(next.tool_calls)) {
    next.tool_calls = next.tool_calls.map((call, i) => {
      if (!call || typeof call !== 'object' || Array.isArray(call)) return call
      const c = call as Record<string, unknown>
      if (!('tool_response' in c)) return call
      return {
        ...c,
        tool_response: stripCrossingResponse(
          c.tool_response,
          `tool_calls.${i}.tool_response`,
          marker,
          failure
        ),
      }
    })
  }
  if (Object.keys(marker).length > 0) next[REDACTED_FIELD] = marker

  const before = canonicalJson(payload)
  const after = canonicalJson(next)
  if (before === after) return null
  return {
    payload: next,
    secrets: redacted.redactedCount,
    bytesBefore: before.length,
    bytesAfter: after.length,
  }
}

export interface CodeBackfillOptions {
  dryRun: boolean
  batchSize?: number
  /** Resume after this event id (the `lastId` a previous run printed). */
  afterId?: string | null
  /** Stop after scanning this many rows (a trial run). */
  limit?: number
  onBatch?: (stats: CodeBackfillStats) => void
}

export interface CodeBackfillStats {
  scanned: number
  toRewrite: number
  written: number
  skippedCrossing: number
  rowsWithSecrets: number
  secrets: number
  bytesBefore: number
  bytesAfter: number
  /** Last id scanned — pass as `afterId` to resume. */
  lastId: string | null
}

export const hookEventCodeBackfillService = {
  /**
   * The crossing-referenced events `run` skips: credential redaction,
   * `originalFile` and Bash output removal only (see rewriteCrossingPayload).
   */
  async runCrossingRows(options: {
    dryRun: boolean
  }): Promise<CodeBackfillStats> {
    const stats: CodeBackfillStats = {
      scanned: 0,
      toRewrite: 0,
      written: 0,
      skippedCrossing: 0,
      rowsWithSecrets: 0,
      secrets: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      lastId: null,
    }
    const ids =
      await hookEventCodeBackfillRepository.listCrossingReferencedEventIds()
    for (let i = 0; i < ids.length; i += 200) {
      const rows = await hookEventCodeBackfillRepository.findUnprunedByIds(
        ids.slice(i, i + 200)
      )
      stats.scanned += rows.length
      const updates: PayloadRewrite[] = []
      for (const row of rows) {
        const rewrite = rewriteCrossingPayload(row.type, row.payload)
        if (!rewrite) continue
        stats.toRewrite++
        stats.bytesBefore += rewrite.bytesBefore
        stats.bytesAfter += rewrite.bytesAfter
        if (rewrite.secrets > 0) {
          stats.rowsWithSecrets++
          stats.secrets += rewrite.secrets
        }
        updates.push({
          id: row.id,
          workspaceId: row.workspaceId,
          payload: rewrite.payload as Prisma.InputJsonValue,
        })
      }
      if (rows.length > 0) stats.lastId = rows[rows.length - 1]!.id
      if (!options.dryRun) {
        stats.written +=
          await hookEventCodeBackfillRepository.rewritePayloads(updates)
      }
    }
    return stats
  },

  async run(options: CodeBackfillOptions): Promise<CodeBackfillStats> {
    const take = options.batchSize ?? 200
    const stats: CodeBackfillStats = {
      scanned: 0,
      toRewrite: 0,
      written: 0,
      skippedCrossing: 0,
      rowsWithSecrets: 0,
      secrets: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      lastId: options.afterId ?? null,
    }

    for (;;) {
      if (options.limit !== undefined && stats.scanned >= options.limit) break
      const page = await hookEventCodeBackfillRepository.findPage(
        stats.lastId,
        options.limit !== undefined
          ? Math.min(take, options.limit - stats.scanned)
          : take
      )
      if (page.length === 0) break
      stats.scanned += page.length
      stats.lastId = page[page.length - 1]!.id

      const planned = page.flatMap(row => {
        const rewrite = rewriteStoredPayload(row.type, row.payload)
        return rewrite
          ? [{ id: row.id, workspaceId: row.workspaceId, rewrite }]
          : []
      })
      const referenced =
        await hookEventCodeBackfillRepository.findCrossingReferencedIds(
          planned.map(p => p.id)
        )
      const updates: PayloadRewrite[] = []
      for (const { id, workspaceId, rewrite } of planned) {
        if (referenced.has(id)) {
          stats.skippedCrossing++
          continue
        }
        stats.toRewrite++
        stats.bytesBefore += rewrite.bytesBefore
        stats.bytesAfter += rewrite.bytesAfter
        if (rewrite.secrets > 0) {
          stats.rowsWithSecrets++
          stats.secrets += rewrite.secrets
        }
        updates.push({
          id,
          workspaceId,
          payload: rewrite.payload as Prisma.InputJsonValue,
        })
      }
      if (!options.dryRun) {
        stats.written +=
          await hookEventCodeBackfillRepository.rewritePayloads(updates)
      }
      options.onBatch?.(stats)
    }
    return stats
  },
}
