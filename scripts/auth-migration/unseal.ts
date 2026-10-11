/**
 * LUM-1072 — Decrypt a sealed file (e.g. a --details-out report) to a plaintext file you choose, outside any git repo. Nothing is printed.
 *
 *   npx tsx scripts/auth-migration/unseal.ts (flags: see usage() in ./cli.ts)
 *
 * Runbook: docs/rfc/2026-10-10-LUM-1069-clerk-to-better-auth-runbook.md (private).
 * Logic: lib/services/auth-migration.service.ts and lib/auth-migration/.
 */
import { main } from './run'

void main('unseal')
