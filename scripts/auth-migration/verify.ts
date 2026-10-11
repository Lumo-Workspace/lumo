/**
 * LUM-1072 — Reconcile: Clerk total = imported + skipped, expected accounts exist, and every user id in the identity columns and @mentions exists in auth_users.
 *
 *   npx tsx scripts/auth-migration/verify.ts (flags: see usage() in ./cli.ts)
 *
 * Runbook: docs/rfc/2026-10-10-LUM-1069-clerk-to-better-auth-runbook.md (private).
 * Logic: lib/services/auth-migration.service.ts and lib/auth-migration/.
 */
import { main } from './run'

void main('verify')
