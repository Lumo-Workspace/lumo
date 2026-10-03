/**
 * LUM-840 backfill: classify historical Bash hook events onto
 * `HookEvent.toolDetail` (purpose bucket) and `HookEvent.toolVerb` (the command
 * that decided it) so tasks recorded before those columns existed also show
 * `Bash · <purpose>` rows — and their per-command drill-down — in operation
 * cost / lineage Top-5.
 *
 * Reads `payload.tool_input.command` of Bash rows, walking an id cursor in
 * batches, and classifies with the same function the record path uses.
 *
 * Source set:
 *   - default: rows with `toolDetail IS NULL` (never classified)
 *   - `--reclassify=<category>`: rows stored under that category — re-run
 *     after changing classifier rules (`--reclassify-other` is an alias for
 *     `--reclassify=other`)
 *   - `--reclassify=all`: every Bash row — also fills `toolVerb` on rows
 *     classified before it existed
 * Only rows whose category or command actually changed are written, so every
 * mode is idempotent.
 *
 * Every run also reports the most frequent unrecognised verbs among rows that
 * classify as `other` — the list of rules worth adding next.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/backfill-bash-tool-detail.ts
 *       → dry-run, prints per-category counts + top unrecognised verbs
 *   DATABASE_URL=... npx tsx scripts/backfill-bash-tool-detail.ts --commit
 *       → actually update rows
 *   add `--reclassify=<category|all>` to re-run rows already classified
 *   add `--batch=<n>` to change the page size (default 500)
 */
import {
  BASH_CATEGORIES,
  classifyBashPayload,
  isBashCategory,
  unrecognisedVerbs,
  type BashCategory,
  type BashClassification,
} from '../lib/agent-run/bash-category'

export interface BackfillRow {
  id: string
  payload: unknown
  /** Currently stored values; absent/null on never-classified rows. */
  toolDetail?: string | null
  toolVerb?: string | null
}

export interface BackfillDeps {
  /** Next page of source-set Bash rows with id > `afterId`, ordered by id. */
  fetchBatch(afterId: string | null, take: number): Promise<BackfillRow[]>
  /** Store this classification on these ids; returns rows changed. */
  update(value: BashClassification, ids: string[]): Promise<number>
}

/** Which already-classified rows to re-run; null = only unclassified rows. */
export type ReclassifyScope = BashCategory | 'all' | null

export interface BackfillOptions {
  dryRun: boolean
  batchSize: number
  reclassify?: ReclassifyScope
}

export interface BackfillResult {
  scanned: number
  unreadable: number
  /** Rows whose stored category or command differs (would change on dry-run). */
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

    const groups = new Map<
      string,
      { value: BashClassification; ids: string[] }
    >()
    for (const row of rows) {
      const value = classifyBashPayload(row.payload)
      if (!value) {
        result.unreadable += 1
        continue
      }
      const { category, verb } = value
      result.byCategory[category] = (result.byCategory[category] ?? 0) + 1
      if (category === 'other') {
        for (const v of unrecognisedVerbs(payloadCommand(row.payload)!)) {
          verbCounts.set(v, (verbCounts.get(v) ?? 0) + 1)
        }
      }
      // Unchanged rows are never written — what makes every mode idempotent.
      if (row.toolDetail === category && (row.toolVerb ?? null) === verb) {
        continue
      }
      const key = `${category}\u0000${verb ?? ''}`
      const group = groups.get(key) ?? { value, ids: [] }
      group.ids.push(row.id)
      groups.set(key, group)
      result.changed += 1
    }
    if (!opts.dryRun) {
      for (const { value, ids } of groups.values()) {
        result.updated += await deps.update(value, ids)
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

export function parseArgs(argv: string[]): BackfillOptions {
  const batchFlag = argv.find(a => a.startsWith('--batch='))
  const batchSize = batchFlag ? Number(batchFlag.slice('--batch='.length)) : 500
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(`--batch must be a positive integer, got ${batchFlag}`)
  }
  const scopeFlag = argv.find(a => a.startsWith('--reclassify='))
  let reclassify: ReclassifyScope = argv.includes('--reclassify-other')
    ? 'other'
    : null
  if (scopeFlag) {
    const scope = scopeFlag.slice('--reclassify='.length)
    if (scope !== 'all' && !isBashCategory(scope)) {
      throw new Error(
        `--reclassify must be 'all' or one of ${BASH_CATEGORIES.join(', ')}, got '${scope}'`
      )
    }
    reclassify = scope
  }
  return { dryRun: !argv.includes('--commit'), batchSize, reclassify }
}

async function main() {
  const { prisma } = await import('../lib/db/prisma')
  // LUM-863: payloads may be stored encrypted.
  const { openHookPayloads } = await import('../lib/hook-event/payload-cipher')
  const opts = parseArgs(process.argv)
  const scope = opts.reclassify ?? null
  console.log(
    `${opts.dryRun ? '[DRY RUN] no rows will be updated' : '[COMMIT] rows will be updated'}` +
      ` · source: ${scope === null ? 'unclassified rows' : scope === 'all' ? 'every Bash row' : `rows stored as '${scope}'`}`
  )
  const result = await backfillBashToolDetail(
    {
      fetchBatch: async (afterId, take) =>
        openHookPayloads(
          await prisma.hookEvent.findMany({
            where: {
              toolName: 'Bash',
              ...(scope === 'all' ? {} : { toolDetail: scope }),
              ...(afterId ? { id: { gt: afterId } } : {}),
            },
            orderBy: { id: 'asc' },
            take,
            select: {
              id: true,
              payload: true,
              payloadEncrypted: true,
              toolDetail: true,
              toolVerb: true,
            },
          })
        ),
      update: async ({ category, verb }, ids) => {
        const { count } = await prisma.hookEvent.updateMany({
          where: { id: { in: ids }, toolName: 'Bash' },
          data: { toolDetail: category, toolVerb: verb },
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
