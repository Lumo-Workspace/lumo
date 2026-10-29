import {
  secretStockRepository,
  type StockColumnRewrite,
  type StockRow,
  type StockTableRef,
} from '@/lib/repositories/secret-stock.repository'
import { redactForStorage } from '@/lib/security-scan/scan-secrets'
import {
  redactHookPayload,
  redactJsonForStorage,
} from '@/lib/validation/hook-payload'
import { isPrunedPayload } from '@/lib/hook-event/retention'
import { canonicalJson } from '@/lib/services/hook-event-code-backfill.service'

/**
 * LUM-898 — re-redact credential shapes already stored in production, with
 * the registry as it is today. HookEvent rows written before LUM-887 kept
 * shapes its rules did not know yet; several other tables (comments, memory,
 * artifacts, crossing explanations …) are written with no redaction at all.
 *
 * Each stored value gets exactly the pass new data gets: HookEvent.payload
 * goes through `redactHookPayload` (its `_lumo_redaction` count accumulates),
 * other JSON columns through the same deep pass without a marker, text
 * columns through `redactForStorage`. A value is rewritten only when its
 * canonical (key-sorted) JSON changed — jsonb reorders keys.
 */

type RedactionMarker = { count?: unknown }

/** The value `stored` should hold today, or null when it already does. */
export function reredactStoredValue(
  table: Pick<StockTableRef, 'delegate'>,
  field: string,
  stored: unknown
): { value: unknown; secrets: number } | null {
  if (stored == null) return null
  let next: unknown
  let secrets: number
  if (typeof stored === 'string') {
    const r = redactForStorage(stored)
    next = r.text
    secrets = r.redactedCount
  } else if (
    table.delegate === 'hookEvent' &&
    field === 'payload' &&
    typeof stored === 'object' &&
    !Array.isArray(stored)
  ) {
    if (isPrunedPayload(stored)) return null
    const payload = stored as Record<string, unknown>
    const r = redactHookPayload(payload)
    secrets = r.redactedCount
    next = r.payload
    if (r.payload !== payload) {
      // Our own marker from ingest (or an earlier pass): add to its count.
      const prev = (payload['_lumo_redaction'] ?? {}) as RedactionMarker
      const prevCount = typeof prev.count === 'number' ? prev.count : 0
      r.payload['_lumo_redaction'] = {
        ...(prev as object),
        count: prevCount + secrets,
      }
    }
  } else {
    const r = redactJsonForStorage(stored)
    next = r.value
    secrets = r.redactedCount
  }
  if (canonicalJson(next) === canonicalJson(stored)) return null
  return { value: next, secrets }
}

export interface StockRowRewrite {
  id: string
  columns: StockColumnRewrite[]
  secrets: number
}

/** Every column of `row` that needs rewriting, or null for a clean row. */
export function planStockRowRewrite(
  table: StockTableRef,
  row: StockRow
): StockRowRewrite | null {
  const columns: StockColumnRewrite[] = []
  let secrets = 0
  for (const field of table.fields) {
    const out = reredactStoredValue(table, field, row[field])
    if (!out) continue
    columns.push({ field, before: row[field], after: out.value })
    secrets += out.secrets
  }
  return columns.length > 0 ? { id: row.id, columns, secrets } : null
}

/**
 * A redacted line cut to `max` characters for the `--show` report, never
 * inside a `…(len N)` token: a cut token no longer reads as a redaction.
 */
export function clipRedactedLine(line: string, max = 200): string {
  let end = Math.min(line.length, max)
  const open = line.lastIndexOf('…(', end)
  if (open >= 0 && open < end) {
    const close = line.indexOf(')', open)
    if (close >= end) end = close + 1
  }
  return line.slice(0, end)
}

/** `--apply` must name the host it writes to; returns the connected host. */
export function assertApplyHost(
  databaseUrl: string | undefined,
  confirmHost: string | undefined
): string {
  const host = new URL(databaseUrl ?? 'postgres://unset').host
  if (confirmHost !== host) {
    throw Object.assign(
      new Error(
        `Refusing --apply: --confirm-host must equal the connected DB host (${host}).`
      ),
      { status: 400 }
    )
  }
  return host
}

export interface StockTableStats {
  label: string
  scanned: number
  /** Rows the injected classifier flags before the rewrite. */
  hit: number
  toRewrite: number
  written: number
  /** Planned rows whose value changed (or got pruned) after it was read. */
  skippedChanged: number
  secrets: number
  /** Rule id → rows the classifier still flags AFTER the planned rewrite. */
  residual: Map<string, number>
  lastId: string | null
}

export interface StockReredactOptions {
  dryRun: boolean
  afterId?: string | null
  limit?: number
  batchSize?: number
  /** Stock classifier (lib/security-scan/secret-stock) for the report. */
  classify?: (values: unknown[]) => Set<string>
  onRow?: (row: StockRow, rewrite: StockRowRewrite | null) => void
  onBatch?: (stats: StockTableStats) => void
}

export const secretStockReredactService = {
  async runTable(
    table: StockTableRef,
    options: StockReredactOptions
  ): Promise<StockTableStats> {
    const take = options.batchSize ?? 200
    const stats: StockTableStats = {
      label: table.label,
      scanned: 0,
      hit: 0,
      toRewrite: 0,
      written: 0,
      skippedChanged: 0,
      secrets: 0,
      residual: new Map(),
      lastId: options.afterId ?? null,
    }
    for (;;) {
      if (options.limit !== undefined && stats.scanned >= options.limit) break
      const page = await secretStockRepository.findPage(
        table,
        stats.lastId,
        options.limit !== undefined
          ? Math.min(take, options.limit - stats.scanned)
          : take
      )
      if (page.length === 0) break
      stats.scanned += page.length
      stats.lastId = page[page.length - 1]!.id

      const planned: { row: StockRow; rewrite: StockRowRewrite }[] = []
      for (const row of page) {
        const rewrite = planStockRowRewrite(table, row)
        if (options.classify) {
          if (options.classify(table.fields.map(f => row[f])).size > 0)
            stats.hit++
          if (rewrite) {
            const after = new Map(rewrite.columns.map(c => [c.field, c.after]))
            const left = options.classify(
              table.fields.map(f => (after.has(f) ? after.get(f) : row[f]))
            )
            for (const id of left)
              stats.residual.set(id, (stats.residual.get(id) ?? 0) + 1)
          }
        }
        options.onRow?.(row, rewrite)
        if (!rewrite) continue
        planned.push({ row, rewrite })
        stats.toRewrite++
        stats.secrets += rewrite.secrets
      }
      if (!options.dryRun && planned.length > 0) {
        const written = await secretStockRepository.rewriteRows(
          table,
          planned.map(({ row, rewrite }) => ({
            id: rewrite.id,
            columns: rewrite.columns,
            updatedAt: row.updatedAt as Date | undefined,
            workspaceId: table.workspaceField
              ? (row[table.workspaceField] as string)
              : undefined,
          }))
        )
        stats.written += written
        stats.skippedChanged += planned.length - written
      }
      options.onBatch?.(stats)
    }
    return stats
  },
}
