import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'
import {
  crossingRawRetentionRepository,
  type StockCrossing,
} from '@/lib/repositories/crossing-raw-retention.repository'
import {
  prSecurityScanRepository,
  type RetentionCandidate,
} from '@/lib/repositories/pr-security-scan.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { crossingRawPurgeCutoff } from '@/lib/boundary-crossing/raw-retention'
import {
  buildPurgedDeadLetterPayload,
  deadLetterPurgeCutoff,
} from '@/lib/integrations/github/dead-letter-retention'
import {
  DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS,
  retentionCutoffs,
} from '@/lib/security-scan/evidence-retention'
import { purgeCrossingRaw } from './crossing-raw-retention.service'
import { scanRetentionDueReason } from './scan-evidence-retention.service'
import type { Prisma } from '@prisma/client'

/**
 * LUM-914 — the pre-rule retention stock: data stored before the automatic
 * cleanup rules shipped, which the sweeps deliberately never touch.
 *
 *  - `scan-evidence`: scans from before LUM-911 (`retentionTracked = false`)
 *    still holding code. Judged by the LUM-911 rule
 *    (`scanRetentionDueReason`) under the workspace's current tier.
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

export const RETENTION_STOCK_CATEGORIES = [
  'scan-evidence',
  'crossing-raw',
  'dead-letter',
] as const

export type RetentionStockCategory = (typeof RETENTION_STOCK_CATEGORIES)[number]

export function isRetentionStockCategory(
  value: unknown
): value is RetentionStockCategory {
  return (RETENTION_STOCK_CATEGORIES as readonly unknown[]).includes(value)
}

/** Rows read per stock query. */
const PAGE = 200

/** Explicit transaction timeout for a crossing purge on a remote database. */
const CROSSING_TX = { timeout: 15_000, maxWait: 10_000 } as const

const DAY_MS = 24 * 60 * 60 * 1000

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
  /** scan-evidence only: findings of the due scans (their code goes too). */
  findings?: number
  /** crossing-raw only: the rollout instant the stock is bounded by. */
  rolloutAt?: Date | null
}

export interface StockApplyResult {
  category: RetentionStockCategory
  processed: number
  /** scan-evidence only: findings scrubbed. */
  findings?: number
  /** Last row id processed (progress / resume reference). */
  lastId: string | null
}

export interface StockRunOptions {
  now?: Date
  /** apply: process at most this many due rows. */
  limit?: number
  /** apply: rows per write batch (one transaction for scan evidence). */
  batchSize?: number
  /** crossing-raw: override the detected LUM-912 rollout instant. */
  crossingRolloutAt?: Date
  onBatch?: (progress: { processed: number; lastId: string }) => void
}

/** One stock row as classified: due (with a reason) or held. */
type Classified<T> =
  | { due: true; row: T; reason: string; workspaceId: string; at: Date }
  | { due: false; row: T; reason: string }

interface CategoryDriver<T extends { id: string }> {
  /** Stock rows, classified, page by page. */
  pages(now: Date): AsyncGenerator<Classified<T>[]>
  /** Process due rows (one batch). */
  process(
    rows: Classified<T>[],
    now: Date
  ): Promise<{ processed: number; findings?: number }>
  /** Extra plan fields (scan findings, held remainder…). */
  finishPlan?(plan: StockPlan, dueRows: T[]): Promise<void>
}

function bump(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by
}

// ── scan evidence ────────────────────────────────────────────────────────────

function scanDriver(): CategoryDriver<RetentionCandidate> {
  return {
    async *pages(now) {
      const zeroRetention =
        await workspaceRepository.findZeroScanEvidenceRetentionIds()
      const { hardCap } = retentionCutoffs(now)
      let after: string | null = null
      for (;;) {
        const page = await prSecurityScanRepository.findRetentionCandidates({
          hardCapCutoff: hardCap,
          zeroRetentionWorkspaceIds: zeroRetention,
          after,
          take: PAGE,
          retentionTracked: false,
        })
        if (page.length === 0) return
        after = page[page.length - 1]!.id
        const unfinished =
          await prSecurityScanRepository.findPullRequestsWithUnfinishedScans([
            ...new Set(page.map(c => c.pullRequestId)),
          ])
        const days = await workspaceRepository.findScanEvidenceRetention([
          ...new Set(page.map(c => c.workspaceId)),
        ])
        yield page.map((c): Classified<RetentionCandidate> => {
          const reason = scanRetentionDueReason(
            c,
            days.get(c.workspaceId) ?? DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS,
            !unfinished.has(c.pullRequestId),
            now
          )
          return reason
            ? {
                due: true,
                row: c,
                reason,
                workspaceId: c.workspaceId,
                at: c.finishedAt ?? c.startedAt,
              }
            : { due: false, row: c, reason: 'not_due_yet' }
        })
        if (page.length < PAGE) return
      }
    },
    async process(rows) {
      const counts = await prSecurityScanRepository.scrubCodeForRetention(
        rows.map(r => r.row.id),
        { retentionTracked: false }
      )
      return { processed: counts.scans, findings: counts.findings }
    },
    async finishPlan(plan, dueRows) {
      let findings = 0
      for (let i = 0; i < dueRows.length; i += PAGE) {
        const counts = await prSecurityScanRepository.countFindingsByScan(
          dueRows.slice(i, i + PAGE).map(r => r.id)
        )
        for (const n of counts.values()) findings += n
      }
      plan.findings = findings
      // The candidate query only reads scans that could be due (final and
      // past the cap, on an ended PR, or zero retention); the rest of the
      // untracked stock is held — open PRs inside the cap, unfinished scans.
      const total = await prSecurityScanRepository.countUntrackedUnscrubbed()
      const read = plan.due + (plan.held.not_due_yet ?? 0)
      if (total > read) bump(plan.held, 'not_final_or_open_pr', total - read)
    },
  }
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

function driverFor(
  category: RetentionStockCategory,
  opts: StockRunOptions
): CategoryDriver<{ id: string }> {
  switch (category) {
    case 'scan-evidence':
      return scanDriver() as unknown as CategoryDriver<{ id: string }>
    case 'crossing-raw':
      return crossingDriver(opts) as unknown as CategoryDriver<{ id: string }>
    case 'dead-letter':
      return deadLetterDriver() as unknown as CategoryDriver<{ id: string }>
  }
}

export const retentionStockService = {
  /** Read-only: what the rule would process now, and what it holds back. */
  async plan(
    category: RetentionStockCategory,
    opts: StockRunOptions = {}
  ): Promise<StockPlan> {
    const now = opts.now ?? new Date()
    const driver = driverFor(category, opts)
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
    const driver = driverFor(category, opts)
    const result: StockApplyResult = {
      category,
      processed: 0,
      lastId: null,
      ...(category === 'scan-evidence' ? { findings: 0 } : {}),
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
