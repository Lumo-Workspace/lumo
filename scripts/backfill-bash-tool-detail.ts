/**
 * LUM-840 backfill: classify historical Bash hook events onto
 * `HookEvent.toolDetail` so tasks recorded before the column existed also show
 * `Bash · <purpose>` rows in operation cost / lineage Top-5.
 *
 * Reads `payload.tool_input.command` of Bash rows, walking an id cursor in
 * batches, and classifies with the same function the record path uses.
 *
 * Two source sets:
 *   - default: rows with `toolDetail IS NULL` (never classified)
 *   - `--reclassify-other`: rows stored as `other` — re-run after adding
 *     classifier rules; only rows whose category now differs are updated
 * Idempotent either way: an updated row leaves its source set, and a row that
 * still classifies the same is never written.
 *
 * Every run also reports the most frequent unrecognised verbs among rows that
 * classify as `other` — the list of rules worth adding next.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/backfill-bash-tool-detail.ts
 *       → dry-run, prints per-category counts + top unrecognised verbs
 *   DATABASE_URL=... npx tsx scripts/backfill-bash-tool-detail.ts --commit
 *       → actually update rows
 *   add `--reclassify-other` to re-run rows already stored as `other`
 *   add `--batch=<n>` to change the page size (default 500)
 */
import {
  toolDetailFromPayload,
  unrecognisedVerbs,
  type BashCategory,
} from '../lib/agent-run/bash-category'

export interface BackfillRow {
  id: string
  payload: unknown
}

export interface BackfillDeps {
  /** Next page of source-set Bash rows with id > `afterId`, ordered by id. */
  fetchBatch(afterId: string | null, take: number): Promise<BackfillRow[]>
  /** Set `toolDetail` on these ids (only where still in the source set); returns rows changed. */
  update(category: BashCategory, ids: string[]): Promise<number>
}

export interface BackfillOptions {
  dryRun: boolean
  batchSize: number
  /** Source set is rows stored as `other` rather than unclassified rows. */
  reclassifyOther?: boolean
}

export interface BackfillResult {
  scanned: number
  unreadable: number
  /** Rows that would change (dry-run) or did change (commit). */
  changed: number
  updated: number
  byCategory: Partial<Record<BashCategory, number>>
  /** Unrecognised verbs among rows classifying as `other`, most frequent first. */
  topOtherVerbs: { verb: string; count: number }[]
}

const TOP_OTHER_VERBS = 20

function payloadCommand(payload: unknown): string | null {
  const input = (payload as { tool_input?: { command?: unknown } } | null)
    ?.tool_input
  return typeof input?.command === 'string' ? input.command : null
}

export async function backfillBashToolDetail(
  deps: BackfillDeps,
  opts: BackfillOptions
): Promise<BackfillResult> {
  const result: BackfillResult = {
    scanned: 0,
    unreadable: 0,
    changed: 0,
    updated: 0,
    byCategory: {},
    topOtherVerbs: [],
  }
  const verbCounts = new Map<string, number>()
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
      result.byCategory[category] = (result.byCategory[category] ?? 0) + 1
      if (category === 'other') {
        for (const verb of unrecognisedVerbs(payloadCommand(row.payload)!)) {
          verbCounts.set(verb, (verbCounts.get(verb) ?? 0) + 1)
        }
        // Re-classifying `other` as `other` is a no-op write.
        if (opts.reclassifyOther) continue
      }
      const ids = idsByCategory.get(category) ?? []
      ids.push(row.id)
      idsByCategory.set(category, ids)
      result.changed += 1
    }
    if (!opts.dryRun) {
      for (const [category, ids] of idsByCategory) {
        result.updated += await deps.update(category, ids)
      }
    }
    if (rows.length < opts.batchSize) break
  }
  result.topOtherVerbs = [...verbCounts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_OTHER_VERBS)
    .map(([verb, count]) => ({ verb, count }))
  return result
}

function parseArgs(argv: string[]): BackfillOptions {
  const batchFlag = argv.find(a => a.startsWith('--batch='))
  const batchSize = batchFlag ? Number(batchFlag.slice('--batch='.length)) : 500
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`--batch must be a positive integer, got ${batchFlag}`)
  }
  return {
    dryRun: !argv.includes('--commit'),
    batchSize,
    reclassifyOther: argv.includes('--reclassify-other'),
  }
}

async function main() {
  const { prisma } = await import('../lib/db/prisma')
  const opts = parseArgs(process.argv)
  const source = opts.reclassifyOther ? 'other' : null
  console.log(
    `${opts.dryRun ? '[DRY RUN] no rows will be updated' : '[COMMIT] rows will be updated'}` +
      ` · source: ${source === null ? 'unclassified rows' : "rows stored as 'other'"}`
  )
  const result = await backfillBashToolDetail(
    {
      fetchBatch: (afterId, take) =>
        prisma.hookEvent.findMany({
          where: {
            toolName: 'Bash',
            toolDetail: source,
            ...(afterId ? { id: { gt: afterId } } : {}),
          },
          orderBy: { id: 'asc' },
          take,
          select: { id: true, payload: true },
        }),
      update: async (category, ids) => {
        const { count } = await prisma.hookEvent.updateMany({
          where: { id: { in: ids }, toolDetail: source },
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
      `${opts.dryRun ? `would update ${result.changed}` : `updated ${result.updated}`}`
  )
  for (const [category, n] of Object.entries(result.byCategory).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${category.padEnd(10)} ${n}`)
  }
  if (result.topOtherVerbs.length > 0) {
    console.log('Top unrecognised verbs in other (candidates for new rules):')
    for (const { verb, count } of result.topOtherVerbs) {
      console.log(`  ${verb.padEnd(24)} ${count}`)
    }
  }
  await prisma.$disconnect()
}

if (require.main === module) {
  main().catch(e => {
    console.error(e)
    process.exit(1)
  })
}
