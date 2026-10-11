/**
 * LUM-1072 — Export every Clerk user through the Backend API (read-only GETs, paged, 429 backoff) and join the sealed Dashboard CSV (password hashes) into one sealed bundle. Key: CLERK_MIGRATION_SECRET_KEY in your own shell.
 *
 *   npx tsx scripts/auth-migration/export.ts (flags: see usage() in ./cli.ts)
 *
 * Runbook: docs/rfc/2026-10-10-LUM-1069-clerk-to-better-auth-runbook.md (private).
 * Logic: lib/services/auth-migration.service.ts and lib/auth-migration/.
 */
import { main } from './run'

void main('export')
