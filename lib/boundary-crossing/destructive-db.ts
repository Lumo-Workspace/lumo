/**
 * The built-in DESTRUCTIVE_DB_COMMAND segment test (LUM-751), moved out of the
 * boundary detector service so the project `migration-command` predicate
 * (LUM-1236) can tell which segments the built-in already reports — one real
 * `prisma migrate reset` is one crossing, not a built-in one plus a project
 * rule one. Pure.
 */
import { executingSegments } from './command-shape'

/** Tool-specific irreversibles — fire on any executing segment. */
const DB_TOOL_RESET =
  /prisma\s+migrate\s+reset|\bdb\s+push\b[^\n]*--(?:force-reset|accept-data-loss)/
/** Generic SQL drop/truncate phrases. */
const DB_DDL_PHRASE = /\bdrop\s+(?:database|table)\b|\btruncate\s+table\b/i

/** Does one EXECUTING segment run an irreversible DB command? */
export function isDestructiveDbSegment(segment: string): boolean {
  return DB_TOOL_RESET.test(segment) || DB_DDL_PHRASE.test(segment)
}

/**
 * Irreversible / data-destroying DB commands. LUM-751: segment-scoped and
 * print/search-aware — only EXECUTING segments (see
 * lib/boundary-crossing/command-shape) are tested, so a `grep` / `echo` /
 * `git log --grep` naming DDL, the same grep inside a `bash -c '…'` wrapper, or
 * a PR body / commit message never trips it, while `psql -c "…"`,
 * `mysql -e "…"` and `prisma migrate reset` still do. (Re-instates the LUM-426
 * print-or-search exclusion that the prose gate had absorbed, deterministic
 * this time — no LLM round-trip for the obvious shapes.)
 */
export function matchDestructiveDb(cmd: string): boolean {
  return executingSegments(cmd).some(isDestructiveDbSegment)
}
