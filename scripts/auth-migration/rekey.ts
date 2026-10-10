/**
 * LUM-1072 — Rollback helper: rewrite window-period Better Auth user ids to new Clerk ids in every identity column and @mention (dry run; --confirm). --window-since lists the users to recreate.
 *
 *   npx tsx scripts/auth-migration/rekey.ts (flags: see usage() in ./cli.ts)
 *
 * Runbook: docs/rfc/2026-10-10-LUM-1069-clerk-to-better-auth-runbook.md (private).
 * Logic: lib/services/auth-migration.service.ts and lib/auth-migration/.
 */
import { main } from './run'

void main('rekey')
