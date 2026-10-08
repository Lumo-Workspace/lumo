#!/usr/bin/env node
/**
 * LUM-1030 — create / upgrade the self-hosted Postgres World's own schemas
 * (`workflow`, `workflow_drizzle`, `graphile_worker`) in WORKFLOW_POSTGRES_URL.
 * Never touches Prisma's `public` schema and is not a Prisma migration.
 * Idempotent — safe to run before every start.
 *
 * Deploy order (docs/self-hosting/workflow.md):
 *   npx prisma migrate deploy  →  npm run workflow:bootstrap  →  next start
 *
 * Wraps `@workflow/world-postgres`'s own `bootstrap` CLI, but refuses to run
 * without WORKFLOW_POSTGRES_URL: the CLI would otherwise fall back to
 * DATABASE_URL (often a pooler URL) or to postgres://world:world@localhost.
 *
 * LUM-1032 — it also refuses a database the CLI cannot migrate. The CLI runs
 * drizzle's migrator, which applies only the migrations dated AFTER the
 * newest one recorded in `workflow_drizzle.workflow_migrations`.
 * world-postgres 4.3.9 shipped migration 0015 without 0011–0014 (all four
 * dated before 0015), so on a database bootstrapped by 4.x the 5.x CLI skips
 * them and then fails inside 0021 with `column run.attributes does not exist`
 * (reproduced in LUM-1032). Any migration older than the newest applied one
 * and not applied itself is that state; the refusal names the way out.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const WORLD_SCHEMAS = ['workflow', 'workflow_drizzle', 'graphile_worker']

/**
 * Journal entries drizzle's migrator would never apply: dated before the
 * newest applied migration, but not applied themselves.
 *
 * @param {{ tag: string, when: number }[]} journal the package's migrations
 * @param {number[]} appliedCreatedAts `created_at` of every recorded migration
 * @returns {string[]} the tags that would be skipped, in journal order
 */
export function skippedWorldMigrations(journal, appliedCreatedAts) {
  if (appliedCreatedAts.length === 0) return []
  const applied = new Set(appliedCreatedAts.map(Number))
  const newest = Math.max(...applied)
  return journal
    .filter(entry => entry.when < newest && !applied.has(entry.when))
    .map(entry => entry.tag)
}

/** The refusal printed for a half-migrated (4.x-bootstrapped) database. */
export function legacyDatabaseMessage(skipped) {
  return [
    `workflow:bootstrap: refusing to run — this database was bootstrapped by @workflow/world-postgres 4.x and the 5.x migrator would skip ${skipped.join(', ')}.`,
    'Upgrade path (docs/self-hosting/workflow.md, "Upgrading from Workflow SDK 4.x"):',
    '  1. Drain: let in-flight workflow runs finish or cancel them — 4.x runs cannot continue on 5.x.',
    `  2. Drop the World's schemas (this deletes all workflow run history, never Lumo's data):`,
    `       DROP SCHEMA ${WORLD_SCHEMAS.join(', ')} CASCADE;`,
    '  3. Re-run npm run workflow:bootstrap, then start the app.',
  ].join('\n')
}

function readJournal() {
  const cli = fileURLToPath(import.meta.resolve('@workflow/world-postgres/cli'))
  const file = join(
    dirname(cli),
    '..',
    'src',
    'drizzle',
    'migrations',
    'meta',
    '_journal.json'
  )
  return JSON.parse(readFileSync(file, 'utf8')).entries
}

async function appliedMigrationTimes(connectionString) {
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString })
  await client.connect()
  try {
    const exists = await client.query(
      "select to_regclass('workflow_drizzle.workflow_migrations') as t"
    )
    if (!exists.rows[0]?.t) return []
    const { rows } = await client.query(
      'select created_at from workflow_drizzle.workflow_migrations'
    )
    return rows.map(row => Number(row.created_at))
  } finally {
    await client.end()
  }
}

async function main() {
  const url = process.env.WORKFLOW_POSTGRES_URL
  if (!url) {
    process.stderr.write(
      'workflow:bootstrap: WORKFLOW_POSTGRES_URL is not set (use the direct, non-pooler connection string)\n'
    )
    process.exit(1)
  }
  const skipped = skippedWorldMigrations(
    readJournal(),
    await appliedMigrationTimes(url)
  )
  if (skipped.length > 0) {
    process.stderr.write(`${legacyDatabaseMessage(skipped)}\n`)
    process.exit(1)
  }
  const { setupDatabase } = await import('@workflow/world-postgres/cli')
  await setupDatabase()
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
