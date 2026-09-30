/**
 * LUM-916 — move uploads stored before LUM-916 as PUBLIC Vercel Blobs (test
 * evidence, editor images) to private blobs behind `GET /api/files/...`, and
 * rewrite every stored reference to the new URL. Workspace logos are left
 * public on purpose (see docs/privacy/uploaded-files.md).
 *
 * Usage:
 *   npx tsx scripts/migrate-public-blobs.ts                     # read-only report
 *   npx tsx scripts/migrate-public-blobs.ts --apply --confirm-host <db host> \
 *     [--origin https://www.uselumo.ai] [--delete-orphans]
 *
 * Read-only unless `--apply`. `--apply` refuses unless `--confirm-host`
 * equals the host of DATABASE_URL, so a run never lands on a database the
 * operator did not name. Production runs need the user's explicit go-ahead
 * after they have seen the read-only numbers.
 *
 * After `--apply`, the old public links stop working — including any pasted
 * into PR comments, Slack or external docs. Safe to re-run: target paths are
 * derived from the source URL, and a finished run leaves nothing to do.
 */
import { config } from 'dotenv'
// Same env posture as the other backfills: prod DB + blob token from
// .env.production unless LUMO_ENV_FILE points elsewhere.
config({ path: process.env.LUMO_ENV_FILE ?? '.env.production' })

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const apply = process.argv.includes('--apply')
  const deleteOrphans = process.argv.includes('--delete-orphans')
  const host = new URL(process.env.DATABASE_URL ?? 'postgres://unset').host
  if (apply && flag('--confirm-host') !== host) {
    console.error(
      `Refusing --apply: --confirm-host must equal the connected DB host (${host}).`
    )
    process.exit(2)
  }
  if (deleteOrphans && !apply) {
    console.error('--delete-orphans only makes sense with --apply.')
    process.exit(2)
  }

  // Dynamic imports AFTER dotenv so Prisma / the blob SDK see the env.
  const { resolvePublicUrl } = await import('@/lib/utils/public-url')
  const { migratePublicBlobs } =
    await import('@/lib/services/public-blob-migration.service')
  const { publicBlobMigrationRepository } =
    await import('@/lib/repositories/public-blob-migration.repository')
  const blob = await import('@/lib/services/public-blob-migration-blob')
  const { prisma } = await import('@/lib/db/prisma')

  const origin = flag('--origin') ?? resolvePublicUrl()
  const mode = apply ? 'apply' : 'read-only'
  console.log(`[${mode}] public blob migration · db ${host} · origin ${origin}`)

  const report = await migratePublicBlobs(
    {
      listPublicBlobs: blob.listPublicBlobs,
      copyToPrivate: blob.copyToPrivate,
      deletePublic: blob.deletePublic,
      findTaskWorkspaceId: publicBlobMigrationRepository.findTaskWorkspaceId,
      sources: publicBlobMigrationRepository.referenceSources,
    },
    { apply, deleteOrphans, origin }
  )
  console.log(JSON.stringify(report, null, 2))
  await prisma.$disconnect()
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
