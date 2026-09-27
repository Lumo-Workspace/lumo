import type { HookEventType, Prisma } from '@prisma/client'
import { hookEventCodeBackfillRepository } from '@/lib/repositories/hook-event-code-backfill.repository'
import { redactHookPayload } from '@/lib/validation/hook-payload'
import {
  REDACTED_FIELD,
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
        return rewrite ? [{ id: row.id, rewrite }] : []
      })
      const referenced =
        await hookEventCodeBackfillRepository.findCrossingReferencedIds(
          planned.map(p => p.id)
        )
      const updates: { id: string; payload: Prisma.InputJsonValue }[] = []
      for (const { id, rewrite } of planned) {
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
