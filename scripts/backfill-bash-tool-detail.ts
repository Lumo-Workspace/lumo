/**
 * LUM-840 one-shot backfill: classify historical Bash hook events onto
 * `HookEvent.toolDetail` so tasks recorded before the column existed also show
 * `Bash · <purpose>` rows in operation cost / lineage Top-5.
 *
 * Reads `payload.tool_input.command` of rows where `toolName = 'Bash'` and
 * `toolDetail IS NULL`, walking an id cursor in batches, and classifies with
 * the same function the record path uses. Idempotent: classified rows leave
 * the `toolDetail IS NULL` set; rows with no readable command stay null and
 * are only ever skipped.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/backfill-bash-tool-detail.ts
 *       → dry-run, prints per-category counts
 *   DATABASE_URL=... npx tsx scripts/backfill-bash-tool-detail.ts --commit
 *       → actually update rows
 *   add `--batch=<n>` to change the page size (default 500)
 */
import {
  toolDetailFromPayload,
  type BashCategory,
} from '../lib/agent-run/bash-category'

export interface BackfillRow {
  id: string
  payload: unknown
}

export interface BackfillDeps {
  /** Next page of unclassified Bash rows with id > `afterId`, ordered by id. */
  fetchBatch(afterId: string | null, take: number): Promise<BackfillRow[]>
  /** Set `toolDetail` on these ids (only where still null); returns rows changed. */
  update(category: BashCategory, ids: string[]): Promise<number>
}

export interface BackfillResult {
  scanned: number
  unreadable: number
  updated: number
  byCategory: Partial<Record<BashCategory, number>>
}

export async function backfillBashToolDetail(
  deps: BackfillDeps,
  opts: { dryRun: boolean; batchSize: number }
): Promise<BackfillResult> {
  const result: BackfillResult = {
    scanned: 0,
    unreadable: 0,
    updated: 0,
    byCategory: {},
  }
  let cursor: string | null = null
  for (;;) {
    const rows = await deps.fetchBatch(cursor, opts.batchSize)
    if (rows.length === 0) break
    cursor = rows[rows.length - 1]!.id
    result.scanned += rows.length

    const idsByCategory = new Map<BashCategory, string[]>()
    for (const row of rows) {
      const category = toolDetailFromPayload(row.payload)
      if (!category) {
        result.unreadable += 1
        continue
      }
      const ids = idsByCategory.get(category) ?? []
      ids.push(row.id)
      idsByCategory.set(category, ids)
      result.byCategory[category] = (result.byCategory[category] ?? 0) + 1
    }
    if (!opts.dryRun) {
      for (const [category, ids] of idsByCategory) {
        result.updated += await deps.update(category, ids)
      }
    }
    if (rows.length < opts.batchSize) break
  }
  return result
}

function parseArgs(argv: string[]): { dryRun: boolean; batchSize: number } {
  const batchFlag = argv.find(a => a.startsWith('--batch='))
  const batchSize = batchFlag ? Number(batchFlag.slice('--batch='.length)) : 500
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`--batch must be a positive integer, got ${batchFlag}`)
  }
  return { dryRun: !argv.includes('--commit'), batchSize }
}

async function main() {
  const { prisma } = await import('../lib/db/prisma')
  const opts = parseArgs(process.argv)
  console.log(
    opts.dryRun
      ? '[DRY RUN] no rows will be updated'
      : '[COMMIT] rows will be updated'
  )
  const result = await backfillBashToolDetail(
    {
      fetchBatch: (afterId, take) =>
        prisma.hookEvent.findMany({
          where: {
            toolName: 'Bash',
            toolDetail: null,
            ...(afterId ? { id: { gt: afterId } } : {}),
          },
          orderBy: { id: 'asc' },
          take,
          select: { id: true, payload: true },
        }),
      update: async (category, ids) => {
        const { count } = await prisma.hookEvent.updateMany({
          where: { id: { in: ids }, toolDetail: null },
          data: { toolDetail: category },
        })
        return count
      },
    },
    opts
  )
  console.log(
    `${opts.dryRun ? '[DRY RUN] ' : ''}scanned ${result.scanned} Bash rows, ` +
      `${result.unreadable} without a readable command, ` +
      `${opts.dryRun ? 'would update' : 'updated'} ` +
      `${opts.dryRun ? result.scanned - result.unreadable : result.updated}`
  )
  for (const [category, n] of Object.entries(result.byCategory).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${category.padEnd(10)} ${n}`)
  }
  await prisma.$disconnect()
}

if (require.main === module) {
  main().catch(e => {
    console.error(e)
    process.exit(1)
  })
}
