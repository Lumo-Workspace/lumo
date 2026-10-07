/**
 * LUM-898 backfill — re-redact credential shapes the current registry
 * recognises in rows stored before it did (HookEvent before LUM-887) or
 * stored with no redaction at all (comments, memory, artifacts …). Tables and
 * columns are the LUM-894 stock list (lib/security-scan/secret-stock).
 *
 * Usage:
 *   npx tsx scripts/backfill-secret-stock-reredact.ts --dry-run [--table <label>] [--limit N] [--show]
 *   npx tsx scripts/backfill-secret-stock-reredact.ts --apply --confirm-host <db host> [--table <label>] [--after <id>] [--limit N]
 *
 * `--dry-run` prints per table: rows scanned, rows the stock classifier flags
 * (`hit`, same number count.ts reports), rows to rewrite, and the rule ids the
 * classifier would STILL flag after the rewrite (`residual`). `--show` adds,
 * per rewritten row, its rule ids, how many values look like placeholders
 * (LUM-734 rules) vs live, and the matching lines in REDACTED form — never a
 * raw value. `--apply` refuses unless `--confirm-host` equals the host of
 * DATABASE_URL. Progress lines print `lastId`; with `--table`, pass it back as
 * `--after` to resume.
 *
 * Note: Neon point-in-time restore keeps pre-backfill versions of these rows
 * until its history window passes — rewriting rows is not erasure from backups.
 */
import { config } from 'dotenv'
// Same env posture as the other backfills: prod DB URL from .env.production.
config({ path: process.env.LUMO_ENV_FILE ?? '.env.production' })

import {
  classifyRow,
  stringsOf,
} from '@/lib/security-scan/secret-stock/classify'
import { STOCK_TABLES } from '@/lib/security-scan/secret-stock/tables'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const apply = process.argv.includes('--apply')
  if (dryRun === apply) {
    console.error('Pass exactly one of --dry-run or --apply.')
    process.exit(2)
  }
  const only = flag('--table')
  const afterId = flag('--after') ?? null
  if (afterId && !only) {
    console.error('--after resumes one table: pass --table with it.')
    process.exit(2)
  }
  const limit = flag('--limit') ? Number(flag('--limit')) : undefined
  const show = process.argv.includes('--show')

  // Dynamic import AFTER dotenv so the Prisma client sees DATABASE_URL.
  const { secretStockReredactService, assertApplyHost, clipRedactedLine } =
    await import('@/lib/services/secret-stock-reredact.service')
  const { redactForStorage, redactForInjection } =
    await import('@/lib/security-scan/scan-secrets')
  const { prisma } = await import('@/lib/db/prisma')

  const host = new URL(process.env.DATABASE_URL ?? 'postgres://unset').host
  if (apply) {
    try {
      assertApplyHost(process.env.DATABASE_URL, flag('--confirm-host'))
    } catch (e) {
      console.error((e as Error).message)
      process.exit(2)
    }
  }
  const mode = dryRun ? 'dry-run' : 'apply'
  console.log(
    `[${mode}] LUM-898 secret stock re-redaction · db ${host}` +
      (only ? ` · table ${only}` : '') +
      (afterId ? ` · after ${afterId}` : '') +
      (limit !== undefined ? ` · limit ${limit}` : '')
  )

  const tables = STOCK_TABLES.filter(t => !only || t.label === only)
  if (tables.length === 0) {
    console.error(`No stock table labelled ${only}.`)
    process.exit(2)
  }
  for (const table of tables) {
    let batches = 0
    const stats = await secretStockReredactService.runTable(table, {
      dryRun,
      afterId,
      limit,
      classify: classifyRow,
      onRow: show
        ? (row, rewrite) => {
            if (!rewrite) return
            const before = rewrite.columns.map(c => c.before)
            let live = 0
            let placeholder = 0
            const lines: string[] = []
            for (const s of stringsOf(before)) {
              const r = redactForInjection(s)
              live += r.redactedCount
              placeholder += r.downgradedCount
              for (const line of s.split('\n')) {
                const red = redactForStorage(line).text
                if (red !== line) lines.push(clipRedactedLine(red))
              }
            }
            console.log(
              `  · ${row.id} [${rewrite.columns.map(c => c.field).join(',')}]` +
                ` rules=${[...classifyRow(before)].join(',')}` +
                ` live=${live} placeholder=${placeholder}`
            )
            for (const l of [...new Set(lines)].slice(0, 5))
              console.log(`      ${l}`)
          }
        : undefined,
      onBatch: s => {
        if (++batches % 100 === 0)
          console.error(
            `  … ${s.label} scanned=${s.scanned} toRewrite=${s.toRewrite} written=${s.written} lastId=${s.lastId}`
          )
      },
    })
    const residual = [...stats.residual]
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${id}:${n}`)
      .join(' ')
    console.log(
      `[${mode}] ${stats.label}: scanned=${stats.scanned} hit=${stats.hit}` +
        ` toRewrite=${stats.toRewrite} written=${stats.written}` +
        ` skippedChanged=${stats.skippedChanged} secrets=${stats.secrets}` +
        ` lastId=${stats.lastId}` +
        (residual ? ` · residual after rewrite: ${residual}` : '')
    )
  }
  await prisma.$disconnect()
}

main().catch(error => {
  console.error('[backfill] failed:', error)
  process.exit(1)
})
