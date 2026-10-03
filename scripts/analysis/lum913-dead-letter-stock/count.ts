/**
 * LUM-913 stock — READ-ONLY dry run. Counts dead-lettered PR comment sync jobs
 * that predate LUM-913 (no `deadLetteredAt`, so the daily purge never touches
 * them) and how many still hold the full GitHub webhook payload, per
 * direction, workspace and age. Prints counts, workspace slugs and dates only,
 * never a payload. findMany only — no writes; whether and when to clean the
 * stock is the user's call (LUM-914).
 *
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.local" npx tsx -r dotenv/config \
 *     scripts/analysis/lum913-dead-letter-stock/count.ts
 */
import { AGE_BUCKETS, tallyDeadLetterStock, type StockDb } from './stock'

function out(line: string) {
  process.stdout.write(`${line}\n`)
}

async function main() {
  const { prisma } = await import('@/lib/db/prisma')
  out(
    `[read-only] LUM-913 dead-letter stock · db ${new URL(process.env.DATABASE_URL ?? 'postgres://unset').host}`
  )
  const now = new Date()
  const stock = await tallyDeadLetterStock(prisma as unknown as StockDb, now)

  const l = stock.legacy
  const range = l.oldest
    ? ` · last written ${l.oldest.toISOString().slice(0, 10)}..${l.newest!.toISOString().slice(0, 10)}`
    : ''
  out(
    `\nlegacy (pre-LUM-913, not auto-purged): ${l.rows} rows, ${l.withRawPayload} still hold the webhook payload${range}`
  )
  for (const [dir, n] of Object.entries(l.byDirection)) out(`  ${dir}: ${n}`)
  for (const b of AGE_BUCKETS) out(`  age ${b}: ${l.byAge[b]}`)

  const wsIds = Object.keys(l.byWorkspace)
  const workspaces = await prisma.workspace.findMany({
    where: { id: { in: wsIds } },
    select: { id: true, slug: true },
  })
  const slug = new Map(workspaces.map(w => [w.id, w.slug]))
  for (const [ws, n] of Object.entries(l.byWorkspace).sort(
    (a, b) => b[1] - a[1]
  ))
    out(`  ws ${slug.get(ws) ?? ws}: ${n}`)

  const t = stock.tracked
  out(
    `\ntracked (post-LUM-913, daily cron): ${t.rows} rows · ${t.purged} purged · ${t.awaitingPurge} within the 7-day grace or awaiting the next run`
  )
  await prisma.$disconnect()
}

main().catch(err => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})
