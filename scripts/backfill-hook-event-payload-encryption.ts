/**
 * LUM-863 backfill — encrypt HookEvent payloads stored in plaintext before
 * application-layer encryption existed, using each workspace's data key.
 *
 * Usage (dry run is the default and writes nothing):
 *   npx tsx scripts/backfill-hook-event-payload-encryption.ts [--limit N]
 *   npx tsx scripts/backfill-hook-event-payload-encryption.ts --apply --confirm-host <db host> [--after <id>] [--limit N]
 *
 * Reads `.env.local` unless LUMO_ENV_FILE says otherwise. `--apply` refuses
 * unless `--confirm-host` equals the host of DATABASE_URL and WORKSPACE_KEKS
 * is set. Running it against production is a separate, explicitly approved
 * step — not part of shipping LUM-863.
 *
 * Note: Neon point-in-time restore keeps the plaintext versions of these rows
 * until its history window passes; dropping the plaintext column is a later,
 * separate migration.
 */
import { config } from 'dotenv'
config({ path: process.env.LUMO_ENV_FILE ?? '.env.local' })

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function out(line: string): void {
  process.stdout.write(`${line}\n`)
}

async function main() {
  const apply = process.argv.includes('--apply')
  const host = new URL(process.env.DATABASE_URL ?? 'postgres://unset').host
  if (apply && flag('--confirm-host') !== host) {
    process.stderr.write(
      `Refusing --apply: --confirm-host must equal the connected DB host (${host}).\n`
    )
    process.exit(2)
  }
  const limit = flag('--limit') ? Number(flag('--limit')) : undefined
  const afterId = flag('--after') ?? null

  // Dynamic import AFTER dotenv so the Prisma client sees DATABASE_URL.
  const { hookEventPayloadEncryptionBackfillService } =
    await import('@/lib/services/hook-event-payload-encryption-backfill.service')
  const { prisma } = await import('@/lib/db/prisma')

  const mode = apply ? 'apply' : 'dry-run'
  out(
    `[${mode}] hook-event payload encryption · db ${host}` +
      (afterId ? ` · after ${afterId}` : '') +
      (limit !== undefined ? ` · limit ${limit}` : '')
  )
  let batches = 0
  const stats = await hookEventPayloadEncryptionBackfillService.run({
    apply,
    afterId,
    limit,
    onBatch: s => {
      if (++batches % 50 === 0) {
        out(
          `[${mode}] scanned=${s.scanned} written=${s.written} lastId=${s.lastId}`
        )
      }
    },
  })
  out(
    `[${mode}] done · plaintext rows=${stats.scanned} written=${stats.written} lastId=${stats.lastId}`
  )
  await prisma.$disconnect()
}

main().catch(error => {
  process.stderr.write(`[backfill] failed: ${String(error)}\n`)
  process.exit(1)
})
