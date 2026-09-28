/**
 * LUM-887 / LUM-894 stock assessment — READ-ONLY. Counts stored rows that
 * still hold a credential shape (see classify.ts) per table and per rule, over
 * every column listed in tables.ts. Prints counts only, never a value.
 * findMany only — no writes; whether to re-redact is the user's call.
 *
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/analysis/lum887-secret-stock/count.ts [--limit N] [--table <label>]
 */
import { PRE_LUM887_RULE_IDS, classifyRow } from './classify'
import { STOCK_TABLES, type StockTable } from './tables'

const BATCH = 200

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

interface Tally {
  rows: number
  affected: number
  byRule: Map<string, number>
  workspaces: Set<string>
}

const newTally = (): Tally => ({
  rows: 0,
  affected: 0,
  byRule: new Map(),
  workspaces: new Set(),
})

function record(t: Tally, hits: Set<string>, workspaceId?: unknown) {
  t.rows++
  if (hits.size === 0) return
  t.affected++
  if (typeof workspaceId === 'string') t.workspaces.add(workspaceId)
  for (const id of hits) t.byRule.set(id, (t.byRule.get(id) ?? 0) + 1)
}

function print(name: string, t: Tally) {
  console.log(
    `${name}: ${t.affected}/${t.rows} rows affected` +
      (t.workspaces.size ? ` · ${t.workspaces.size} workspace(s)` : '')
  )
  for (const [id, n] of [...t.byRule].sort((a, b) => b[1] - a[1]))
    console.log(
      `  ${id}: ${n}${PRE_LUM887_RULE_IDS.has(id) ? ' (pre-LUM-887 rule)' : ''}`
    )
}

type Row = Record<string, unknown> & { id: string }
type Delegate = { findMany(args: unknown): Promise<Row[]> }

async function scanTable(
  client: Record<string, unknown>,
  table: StockTable,
  limit: number,
  onRow?: (row: Row, hits: Set<string>) => void
): Promise<Tally> {
  const delegate = client[table.delegate] as Delegate
  const select: Record<string, true> = { id: true }
  for (const f of table.fields) select[f] = true
  if (table.workspaceField) select[table.workspaceField] = true
  const tally = newTally()
  let cursor: string | undefined
  for (;;) {
    const rows = await delegate.findMany({
      ...(table.where ? { where: table.where } : {}),
      select,
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (rows.length === 0) break
    for (const r of rows) {
      const hits = classifyRow(table.fields.map(f => r[f]))
      record(tally, hits, table.workspaceField && r[table.workspaceField])
      onRow?.(r, hits)
    }
    cursor = rows[rows.length - 1]!.id
    if (tally.rows % 20000 < BATCH)
      console.error(
        `  … ${table.label} ${tally.rows} scanned (${tally.affected} hit)`
      )
    if (tally.rows >= limit) break
  }
  return tally
}

async function main() {
  const { prisma } = await import('@/lib/db/prisma')
  const client = prisma as unknown as Record<string, unknown>
  const limit = flag('--limit') ? Number(flag('--limit')) : Infinity
  const only = flag('--table')
  console.log(
    `[read-only] LUM-894 secret stock · db ${new URL(process.env.DATABASE_URL ?? 'postgres://unset').host}`
  )

  const crossingIds = new Set(
    (
      await prisma.boundaryCrossing.findMany({
        where: { hookEventId: { not: null } },
        select: { hookEventId: true },
        distinct: ['hookEventId'],
      })
    ).flatMap(r => (r.hookEventId ? [r.hookEventId] : []))
  )

  for (const table of STOCK_TABLES) {
    if (only && table.label !== only) continue
    const crossing = newTally()
    const tally = await scanTable(
      client,
      table,
      limit,
      table.delegate === 'hookEvent'
        ? (row, hits) => {
            if (crossingIds.has(row.id)) record(crossing, hits, row.workspaceId)
          }
        : undefined
    )
    print(table.label, tally)
    if (table.delegate === 'hookEvent')
      print('  of which crossing-referenced', crossing)
  }

  await prisma.$disconnect()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
