/**
 * LUM-855 backfill — strip customer code (and LUM-859 credentials) out of
 * HookEvent rows stored before ingest-time redaction existed. Every row goes
 * through the same two steps a new row gets today; rows a boundary crossing
 * references are skipped (the crossing re-judge reads their original text).
 * LUM-933: only workspaces in "discard when used up" mode
 * (hookEventRetentionMode = USED_UP) are touched — "keep forever / N days"
 * workspaces keep their session record whole and are always skipped.
 *
 * Usage:
 *   npx tsx scripts/backfill-hook-event-code-strip.ts --dry-run [--limit N]
 *   npx tsx scripts/backfill-hook-event-code-strip.ts --apply --confirm-host <db host> [--after <id>] [--limit N]
 *   add --crossing-rows to treat only the crossing-referenced events the main
 *   pass skips: credential redaction + originalFile removal, tool_input kept.
 *
 * `--apply` refuses unless `--confirm-host` equals the host of DATABASE_URL, so
 * a run can never land on a database the operator did not name. Progress lines
 * print `lastId`; pass it back as `--after` to resume an interrupted run.
 *
 * Note: Neon point-in-time restore keeps pre-backfill versions of these rows
 * until its history window passes — rewriting rows is not erasure from backups.
 */
import { config } from 'dotenv'
// Same env posture as the other backfills: prod DB URL from .env.production.
config({ path: process.env.LUMO_ENV_FILE ?? '.env.production' })

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function mb(n: number): string {
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const apply = process.argv.includes('--apply')
  if (dryRun === apply) {
    console.error('Pass exactly one of --dry-run or --apply.')
    process.exit(2)
  }
  const host = new URL(process.env.DATABASE_URL ?? 'postgres://unset').host
  if (apply && flag('--confirm-host') !== host) {
    console.error(
      `Refusing --apply: --confirm-host must equal the connected DB host (${host}).`
    )
    process.exit(2)
  }
  const limit = flag('--limit') ? Number(flag('--limit')) : undefined
  const afterId = flag('--after') ?? null

  // Dynamic import AFTER dotenv so the Prisma client sees DATABASE_URL.
  const { hookEventCodeBackfillService } =
    await import('@/lib/services/hook-event-code-backfill.service')
  const { prisma } = await import('@/lib/db/prisma')

  const mode = dryRun ? 'dry-run' : 'apply'
  console.log(
    `[${mode}] hook-event code strip · db ${host}` +
      (afterId ? ` · after ${afterId}` : '') +
      (limit !== undefined ? ` · limit ${limit}` : '')
  )
  let batches = 0
  // --crossing-rows: only the events a boundary crossing references (skipped
  // by the main pass) — credential redaction + originalFile removal.
  const stats = process.argv.includes('--crossing-rows')
    ? await hookEventCodeBackfillService.runCrossingRows({ dryRun })
    : await hookEventCodeBackfillService.run({
        dryRun,
        afterId,
        limit,
        onBatch: s => {
          if (++batches % 50 === 0) {
            console.log(
              `[${mode}] scanned=${s.scanned} toRewrite=${s.toRewrite} written=${s.written} lastId=${s.lastId}`
            )
          }
        },
      })
  console.log(
    `[${mode}] done · scanned=${stats.scanned} toRewrite=${stats.toRewrite} written=${stats.written}` +
      ` skippedCrossing=${stats.skippedCrossing}`
  )
  console.log(
    `[${mode}] payload ${mb(stats.bytesBefore)} → ${mb(stats.bytesAfter)}` +
      ` · rows with credentials=${stats.rowsWithSecrets} (${stats.secrets} secrets)` +
      ` · lastId=${stats.lastId}`
  )
  await prisma.$disconnect()
}

main().catch(error => {
  console.error('[backfill] failed:', error)
  process.exit(1)
})
