/**
 * LUM-916 — move uploads stored before LUM-916 as PUBLIC Vercel Blobs (test
 * evidence, editor images) to private blobs behind `GET /api/files/...`, and
 * rewrite every stored reference to the new URL. Workspace logos are left
 * public on purpose (see docs/privacy/uploaded-files.md).
 *
 * Usage:
 *   npx tsx scripts/migrate-public-blobs.ts                     # read-only report
 *   npx tsx scripts/migrate-public-blobs.ts --apply --confirm-host <db host> \
 *     [--origin https://www.uselumo.ai] [--limit N] [--keep-originals] \
 *     [--manifest <file>] [--delete-orphans]
 *
 * Read-only unless `--apply`. `--apply` refuses unless `--confirm-host`
 * equals the host of DATABASE_URL, so a run never lands on a database the
 * operator did not name. Production runs need the user's explicit go-ahead
 * after they have seen the read-only numbers.
 *
 * After `--apply`, the old public links stop working — including any pasted
 * into PR comments, Slack or external docs. Safe to re-run: target paths are
 * derived from the source URL, and a finished run leaves nothing to do.
 *
 * LUM-922 — production goes in batches: `--limit N` migrates only the first
 * N referenced public blobs; repeat until `batch.remaining` is 0.
 * `--keep-originals` deletes no public blob, so the old links keep working
 * and the rewrite can be reversed from the manifest (public URL → new URLs,
 * written on every apply); the kept originals then read as orphans and are
 * removed by a later `--apply --delete-orphans`.
 */
import { config } from 'dotenv'
// Same env posture as the other backfills: prod DB + blob token from
// .env.production unless LUMO_ENV_FILE points elsewhere.
config({ path: process.env.LUMO_ENV_FILE ?? '.env.production' })

// Plain stdout/stderr, not console.* (repo rule: no console.log outside
// scripts/analysis) — this is an operator CLI whose output IS the product.
const out = (line: string) => process.stdout.write(`${line}\n`)
const err = (line: string) => process.stderr.write(`${line}\n`)

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const apply = process.argv.includes('--apply')
  const deleteOrphans = process.argv.includes('--delete-orphans')
  const host = new URL(process.env.DATABASE_URL ?? 'postgres://unset').host
  if (apply && flag('--confirm-host') !== host) {
    err(
      `Refusing --apply: --confirm-host must equal the connected DB host (${host}).`
    )
    process.exit(2)
  }
  if (deleteOrphans && !apply) {
    err('--delete-orphans only makes sense with --apply.')
    process.exit(2)
  }
  const keepOriginals = process.argv.includes('--keep-originals')
  if (deleteOrphans && keepOriginals) {
    err('--delete-orphans contradicts --keep-originals.')
    process.exit(2)
  }
  const limitArg = flag('--limit')
  const limit = limitArg === undefined ? undefined : Number(limitArg)
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
    err('--limit must be a positive integer.')
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
  const { writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const origin = flag('--origin') ?? resolvePublicUrl()
  const mode = apply ? 'apply' : 'read-only'
  out(
    `[${mode}] public blob migration · db ${host} · origin ${origin}` +
      (limit ? ` · limit ${limit}` : '') +
      (keepOriginals ? ' · keep originals' : '')
  )

  const report = await migratePublicBlobs(
    {
      listPublicBlobs: blob.listPublicBlobs,
      copyToPrivate: blob.copyToPrivate,
      deletePublic: blob.deletePublic,
      findTaskWorkspaceId: publicBlobMigrationRepository.findTaskWorkspaceId,
      sources: publicBlobMigrationRepository.referenceSources,
    },
    { apply, deleteOrphans, origin, limit, keepOriginals }
  )
  const { manifest, ...summary } = report
  out(JSON.stringify(summary, null, 2))
  if (apply) {
    const file =
      flag('--manifest') ??
      join(tmpdir(), `public-blob-migration-${Date.now()}.json`)
    writeFileSync(file, JSON.stringify(manifest, null, 2))
    out(`manifest (${manifest.length} blobs) → ${file}`)
  }
  await prisma.$disconnect()
}

main().catch(error => {
  err(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exit(1)
})
