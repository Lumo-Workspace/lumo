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
 */
const url = process.env.WORKFLOW_POSTGRES_URL
if (!url) {
  process.stderr.write(
    'workflow:bootstrap: WORKFLOW_POSTGRES_URL is not set (use the direct, non-pooler connection string)\n'
  )
  process.exit(1)
}
const { setupDatabase } = await import('@workflow/world-postgres/cli')
await setupDatabase()
