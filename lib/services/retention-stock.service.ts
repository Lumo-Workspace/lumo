import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'
import {
  crossingRawRetentionRepository,
  type StockCrossing,
} from '@/lib/repositories/crossing-raw-retention.repository'
import { crossingRawPurgeCutoff } from '@/lib/boundary-crossing/raw-retention'
import {
  buildPurgedDeadLetterPayload,
  deadLetterPurgeCutoff,
} from '@/lib/integrations/github/dead-letter-retention'
import { purgeCrossingRaw } from './crossing-raw-retention.service'
import { pluginRetentionStocks } from '@/lib/plugins/retention'
import type {
  RetentionStockClassified,
  RetentionStockDriver,
  RetentionStockRunOptions,
} from '@/lib/plugins/types'
import type { Prisma } from '@prisma/client'

/**
 * LUM-914 — the pre-rule retention stock: data stored before the automatic
 * cleanup rules shipped, which the sweeps deliberately never touch.
 *
 *  - plugin categories (LUM-1061, the `retention` extension point): with the
 *    security plugin, `scan-evidence` — scans from before LUM-911 still
 *    holding code (ee/security/retention-stock.ts). Without a plugin the
 *    category does not exist.
 *  - `crossing-raw`: crossings dispositioned before the workspace's
 *    `crossingRawRetentionSince` (LUM-912 rollout) still holding raw text.
 *    Judged by `crossingRawPurgeCutoff` under the current tier.
 *  - `dead-letter`: PR comment sync jobs dead-lettered before LUM-913 (no
 *    `deadLetteredAt`) still holding the webhook payload. Judged by
 *    `deadLetterPurgeCutoff`; `updatedAt` stands in for the dead-letter time.
 *
 * A plan only reads. An apply does exactly what the sweep does to a due row
 * (same repository writes, same scrubbed shape, rows and metadata kept) and
 * is idempotent: what it processed no longer matches the stock query. Run by
 * the operator from scripts/retention-stock.ts — never by a cron.
 */

/** The categories the core owns, whatever plugins are installed. */
export const CORE_RETENTION_STOCK_CATEGORIES = [
  'crossing-raw',
  'dead-letter',
] as const

/** A core category, or one a plugin contributed (e.g. `scan-evidence`). */
export type RetentionStockCategory = string

/** Every category of this deployment: plugin categories first, then the core's. */
export function retentionStockCategories(): RetentionStockCategory[] {
  return [
    ...pluginRetentionStocks().map(s => s.category),
    ...CORE_RETENTION_STOCK_CATEGORIES,
  ]
}

export function isRetentionStockCategory(
  value: unknown
): value is RetentionStockCategory {
  return (retentionStockCategories() as unknown[]).includes(value)
}

/** Rows read per stock query. */
const PAGE = 200

/** Explicit transaction timeout for a crossing purge on a remote database. */
const CROSSING_TX = { timeout: 15_000, maxWait: 10_000 } as const

const DAY_MS = 24 * 60 * 60 * 1000

export type StockRunOptions = RetentionStockRunOptions

export interface StockPlan {
  category: RetentionStockCategory
  /** Rows the rule would process now. */
  due: number
  /** Due rows per workspace id. */
  byWorkspace: Record<string, number>
  /** Earliest / latest reference time among due rows (see `referenceTime`). */
  oldest: Date | null
  newest: Date | null
  /** Due rows split by why the rule processes them. */
  byReason: Record<string, number>
  /** Stock rows the rule leaves alone, by why. */
  held: Record<string, number>
  /** Categories whose rows carry secondary rows (scan-evidence: the due
   *  scans' findings, whose code goes too). */
  findings?: number
  /** crossing-raw only: the rollout instant the stock is bounded by. */
  rolloutAt?: Date | null
}

export interface StockApplyResult {
  category: RetentionStockCategory
  processed: number
  /** Categories with secondary rows only (scan-evidence: findings scrubbed). */
  findings?: number
  /** Last row id processed (progress / resume reference). */
  lastId: string | null
}

type Classified<T> = RetentionStockClassified<T>
/** A driver as the core runs it: a plugin driver, or a core one that also
 *  fills core-only plan fields (crossing-raw's `rolloutAt`). */
interface CategoryDriver<T extends { id: string }> extends Omit<
  RetentionStockDriver<T>,
  'finishPlan'
> {
  finishPlan?(plan: StockPlan, dueRows: T[]): Promise<void>
}

function bump(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by
}

// ── crossing raw text ────────────────────────────────────────────────────────

/**
 * The LUM-912 rollout instant: the migration stamped every existing workspace
 * with the same `crossingRawRetentionSince`, and it only ever moves later (a
 * shortened window, LUM-933), so the earliest one is the rollout.
 */
function detectRolloutAt(sinces: Date[]): Date | null {
  if (sinces.length === 0) return null
  return new Date(Math.min(...sinces.map(d => d.getTime())))
}

interface CrossingRow extends StockCrossing {
  /** The purge window the write re-checks (dispositioned inside it). */
  window: { since: Date; before: Date }
}

/** Crossing stock classification (pure). */
export function classifyStockCrossing(input: {
  row: StockCrossing
  retentionDays: number
  rolloutAt: Date
  now: Date
}):
  | { due: true; reason: string; before: Date }
  | { due: false; reason: string } {
  const { row, retentionDays, rolloutAt, now } = input
  if (!row.dispositionedAt) return { due: false, reason: 'no_disposition_time' }
  // Ruled after the rollout but before a shortened window took effect: the
  // longer promise holds (LUM-933) — never purged, by the sweep or by this.
  if (row.dispositionedAt >= rolloutAt)
    return { due: false, reason: 'ruled_under_longer_window' }
  const cutoff = crossingRawPurgeCutoff(now, retentionDays)
  if (row.dispositionedAt > cutoff)
    return { due: false, reason: 'within_window' }
  const beforeRollout = new Date(rolloutAt.getTime() - 1)
  return {
    due: true,
    reason: `disposition:${row.disposition}`,
    before: cutoff < beforeRollout ? cutoff : beforeRollout,
  }
}

function crossingDriver(opts: StockRunOptions): CategoryDriver<CrossingRow> {
  let rolloutAt: Date | null = null
  return {
    async *pages(now) {
      const workspaces =
        await crossingRawRetentionRepository.listWorkspaceSettings()
      rolloutAt =
        opts.crossingRolloutAt ??
        detectRolloutAt(workspaces.map(w => w.crossingRawRetentionSince))
      if (!rolloutAt) return
      for (const ws of workspaces) {
        let afterId: string | null = null
        for (;;) {
          const rows = await crossingRawRetentionRepository.findStock({
            workspaceId: ws.id,
            dispositionedBefore: ws.crossingRawRetentionSince,
            afterId,
            take: PAGE,
          })
          if (rows.length === 0) break
          afterId = rows[rows.length - 1]!.id
          yield rows.map((row): Classified<CrossingRow> => {
            const c = classifyStockCrossing({
              row,
              retentionDays: ws.crossingRawRetentionDays,
              rolloutAt: rolloutAt!,
              now,
            })
            if (!c.due)
              return {
                due: false,
                row: { ...row, window: { since: now, before: now } },
                reason: c.reason,
              }
            return {
              due: true,
              row: { ...row, window: { since: new Date(0), before: c.before } },
              reason: c.reason,
              workspaceId: ws.id,
              at: row.dispositionedAt!,
            }
          })
          if (rows.length < PAGE) break
        }
      }
    },
    async process(rows, now) {
      let processed = 0
      for (const { row } of rows) {
        if (await purgeCrossingRaw(row, row.window, now, CROSSING_TX))
          processed++
      }
      return { processed }
    },
    async finishPlan(plan) {
      plan.rolloutAt = rolloutAt
    },
  }
}

// ── PR comment sync dead letters ─────────────────────────────────────────────

type DeadLetterRow = Awaited<
  ReturnType<typeof prCommentSyncJobRepository.findLegacyDeadLetters>
>[number]

/** How long a due dead letter has sat past its dead-letter time (pure). */
export function deadLetterAgeBucket(updatedAt: Date, now: Date): string {
  const days = (now.getTime() - updatedAt.getTime()) / DAY_MS
  if (days <= 30) return '<=30d'
  if (days <= 90) return '31-90d'
  return '>90d'
}

function deadLetterDriver(): CategoryDriver<DeadLetterRow> {
  return {
    async *pages(now) {
      let afterId: string | null = null
      for (;;) {
        const rows = await prCommentSyncJobRepository.findLegacyDeadLetters({
          afterId,
          take: PAGE,
        })
        if (rows.length === 0) return
        afterId = rows[rows.length - 1]!.id
        yield rows.map((row): Classified<DeadLetterRow> => {
          const cutoff = deadLetterPurgeCutoff(
            now,
            row.workspace.deadLetterRetentionDays
          )
          if (row.updatedAt > cutoff)
            return { due: false, row, reason: 'within_window' }
          return {
            due: true,
            row,
            reason: `${row.direction} · ${deadLetterAgeBucket(row.updatedAt, now)}`,
            workspaceId: row.workspaceId,
            at: row.updatedAt,
          }
        })
        if (rows.length < PAGE) return
      }
    },
    async process(rows, now) {
      let processed = 0
      for (const { row } of rows) {
        const purged = await prCommentSyncJobRepository.purgeDeadLetterPayload(
          row.id,
          buildPurgedDeadLetterPayload(
            row.payload
          ) as unknown as Prisma.InputJsonValue,
          now
        )
        if (purged) processed++
      }
      return { processed }
    },
  }
}

async function driverFor(
  category: RetentionStockCategory,
  opts: StockRunOptions
): Promise<{
  driver: CategoryDriver<{ id: string }>
  countsFindings: boolean
}> {
  switch (category) {
    case 'crossing-raw':
      return {
        driver: crossingDriver(opts) as unknown as CategoryDriver<{
          id: string
        }>,
        countsFindings: false,
      }
    case 'dead-letter':
      return {
        driver: deadLetterDriver() as unknown as CategoryDriver<{
          id: string
        }>,
        countsFindings: false,
      }
  }
  const plugin = pluginRetentionStocks().find(s => s.category === category)
  if (!plugin) throw new Error(`unknown retention-stock category: ${category}`)
  return {
    driver: await plugin.driver(opts),
    countsFindings: plugin.countsFindings === true,
  }
}

export const retentionStockService = {
  /** Read-only: what the rule would process now, and what it holds back. */
  async plan(
    category: RetentionStockCategory,
    opts: StockRunOptions = {}
  ): Promise<StockPlan> {
    const now = opts.now ?? new Date()
    const { driver } = await driverFor(category, opts)
    const plan: StockPlan = {
      category,
      due: 0,
      byWorkspace: {},
      oldest: null,
      newest: null,
      byReason: {},
      held: {},
    }
    const dueRows: { id: string }[] = []
    for await (const page of driver.pages(now)) {
      for (const item of page) {
        if (!item.due) {
          bump(plan.held, item.reason)
          continue
        }
        plan.due++
        dueRows.push(item.row)
        bump(plan.byWorkspace, item.workspaceId)
        bump(plan.byReason, item.reason)
        if (!plan.oldest || item.at < plan.oldest) plan.oldest = item.at
        if (!plan.newest || item.at > plan.newest) plan.newest = item.at
      }
    }
    await driver.finishPlan?.(plan, dueRows)
    return plan
  },

  /**
   * Process the due rows the way the sweep would, `batchSize` at a time, at
   * most `limit` of them. Idempotent: a processed row leaves the stock query.
   */
  async apply(
    category: RetentionStockCategory,
    opts: StockRunOptions = {}
  ): Promise<StockApplyResult> {
    const now = opts.now ?? new Date()
    const batchSize = Math.max(1, opts.batchSize ?? 20)
    const limit = opts.limit ?? Number.POSITIVE_INFINITY
    const { driver, countsFindings } = await driverFor(category, opts)
    const result: StockApplyResult = {
      category,
      processed: 0,
      lastId: null,
      ...(countsFindings ? { findings: 0 } : {}),
    }
    let taken = 0
    for await (const page of driver.pages(now)) {
      const due = page.filter(item => item.due)
      for (let i = 0; i < due.length && taken < limit; i += batchSize) {
        const batch = due.slice(i, Math.min(i + batchSize, i + limit - taken))
        taken += batch.length
        const counts = await driver.process(batch, now)
        result.processed += counts.processed
        if (counts.findings !== undefined)
          result.findings = (result.findings ?? 0) + counts.findings
        result.lastId = batch[batch.length - 1]!.row.id
        opts.onBatch?.({ processed: result.processed, lastId: result.lastId })
      }
      if (taken >= limit) break
    }
    return result
  },
}
