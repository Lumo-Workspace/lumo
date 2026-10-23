/**
 * LUM-1302 backfill — encrypt HookEvent payloads stored before payload
 * encryption shipped (rows with no `payloadKeyId`). Each row is sealed with
 * its workspace's data key, the same way a new row is; the first row of a
 * workspace creates that workspace's key.
 *
 * Usage:
 *   npx tsx scripts/encrypt-hook-event-payloads.ts --dry-run
 *   npx tsx scripts/encrypt-hook-event-payloads.ts --apply --confirm-host <db host> [--after <id>] [--limit N]
 *
 * Run it only after the encrypting code is deployed: a deployment without it
 * would keep writing plaintext rows. `--apply` refuses unless `--confirm-host`
 * equals the host of DATABASE_URL. Progress lines print `lastId`; pass it back
 * as `--after` to resume. A finished apply re-run writes 0 rows.
 *
 * Needs the deployment's ENCRYPTION_KEY: data keys are wrapped with it, and a
 * different key would make every payload sealed here unreadable to the app.
 *
 * Note: Neon point-in-time restore keeps the plaintext versions of these rows
 * until its history window passes — encrypting rows is not erasure from backups.
 */
import { config } from 'dotenv'
// Same env posture as the other backfills: prod DB URL from .env.production.
config({ path: process.env.LUMO_ENV_FILE ?? '.env.production' })

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
  const { hookEventEncryptionBackfillService } =
    await import('@/lib/services/hook-event-encryption-backfill.service')
  const { prisma } = await import('@/lib/db/prisma')

  const mode = dryRun ? 'dry-run' : 'apply'
  console.log(
    `[${mode}] hook-event payload encryption · db ${host}` +
      (afterId ? ` · after ${afterId}` : '') +
      (limit !== undefined ? ` · limit ${limit}` : '')
  )
  let batches = 0
  const stats = await hookEventEncryptionBackfillService.run({
    dryRun,
    afterId,
    limit,
    onBatch: s => {
      if (++batches % 10 === 0) {
        console.log(
          `[${mode}] scanned=${s.scanned} written=${s.written} lastId=${s.lastId}`
        )
      }
    },
  })
  console.log(
    `[${mode}] done · plaintext rows=${stats.scanned} written=${stats.written}` +
      ` workspaces=${stats.workspaces} lastId=${stats.lastId}`
  )
  await prisma.$disconnect()
}

main().catch(error => {
  console.error('[encrypt-hook-event-payloads] failed:', error)
  process.exit(1)
})
