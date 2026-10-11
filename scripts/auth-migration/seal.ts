/**
 * LUM-1072 — Seal (encrypt) a plaintext file, e.g. the Clerk Dashboard CSV, so the other commands can read it. Delete the plaintext afterwards.
 *
 *   npx tsx scripts/auth-migration/seal.ts (flags: see usage() in ./cli.ts)
 *
 * Runbook: docs/rfc/2026-10-10-LUM-1069-clerk-to-better-auth-runbook.md (private).
 * Logic: lib/services/auth-migration.service.ts and lib/auth-migration/.
 */
import { main } from './run'

void main('seal')
