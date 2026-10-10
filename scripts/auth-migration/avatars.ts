/**
 * LUM-1072 — Copy avatars that still point at Clerk to our blob storage and repoint auth_users.image (dry run; --confirm).
 *
 *   npx tsx scripts/auth-migration/avatars.ts (flags: see usage() in ./cli.ts)
 *
 * Runbook: docs/rfc/2026-10-10-LUM-1069-clerk-to-better-auth-runbook.md (private).
 * Logic: lib/services/auth-migration.service.ts and lib/auth-migration/.
 */
import { main } from './run'

void main('avatars')
