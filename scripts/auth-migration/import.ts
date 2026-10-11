/**
 * LUM-1072 — Import the sealed bundle into auth_users / auth_accounts. Dry run by default (counts only); --confirm writes; --closing --since <T_import> is the post-cutover closing increment.
 *
 *   npx tsx scripts/auth-migration/import.ts (flags: see usage() in ./cli.ts)
 *
 * Runbook: docs/rfc/2026-10-10-LUM-1069-clerk-to-better-auth-runbook.md (private).
 * Logic: lib/services/auth-migration.service.ts and lib/auth-migration/.
 */
import { main } from './run'

void main('import')
