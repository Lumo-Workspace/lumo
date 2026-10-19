/**
 * LUM-1236 follow-up — matcher for the compiler-derived `migration-command`
 * policy predicate.
 *
 * Why it exists: CLAUDE.md's "use only `prisma migrate deploy` — never
 * `migrate dev`, `db push`, `migrate reset`, or direct edits to
 * `_prisma_migrations`" was a deterministic, blocking rule until a recompile
 * (COMPILER_VERSION lum1236) reworded it and gave it no predicate at all — it
 * became NO_CHECKER and nothing checked those commands any more (X953/X954).
 * The rule names its commands literally, so the compiler now derives the check
 * from the text (ee/security/services/policy/migration-command-rule) and this
 * module judges it, whatever the model said.
 *
 * Operations (the predicate value lists the ones the rule forbids):
 *
 *   - `migrate-reset` / `db-push` / `migrate-dev` — `prisma … migrate reset`,
 *     `prisma … db push`, `prisma … migrate dev` in an EXECUTING segment
 *     (command-shape: print / search / lumo / gh / commit carriers dropped,
 *     `bash -c '…'` unwrapped), with quoted literals and heredoc bodies
 *     emptied first so a commit message or `--note` naming the command never
 *     counts;
 *   - `migrate-dev@production` — `migrate dev` only when the command line
 *     itself shows a production target (a `DATABASE_URL` / `DIRECT_URL`
 *     assignment whose value names prod, an `.env.prod(uction)` file,
 *     `NODE_ENV=production`). The rules file allows `prisma migrate dev`
 *     against the dev database, and the hook cannot see which database a bare
 *     invocation reaches — judging it by the command alone would flag every
 *     sanctioned schema change (decision recorded on LUM-1236);
 *   - `migrations-table-write` — SQL that writes Prisma's migration history
 *     table (`UPDATE` / `DELETE FROM` / `INSERT INTO` / `TRUNCATE` /
 *     `DROP TABLE` / `ALTER TABLE` on `_prisma_migrations`). Judged on the RAW
 *     executing segment: the SQL of `psql -c "…"` / `prisma db execute
 *     --stdin <<<"…"` IS the action, so its quotes are kept.
 *
 * Pure — no I/O.
 */
import { executingSegments } from '@/lib/boundary-crossing/command-shape'
import { stripHeredocBodies, stripQuotedLiterals } from './action-confirm'

export const MIGRATION_OPS = [
  'migrate-dev',
  'migrate-dev@production',
  'migrate-reset',
  'db-push',
  'migrations-table-write',
] as const

export type MigrationOp = (typeof MIGRATION_OPS)[number]

const KNOWN_OPS: ReadonlySet<string> = new Set(MIGRATION_OPS)

/** Parse a `migration-command` predicate value; unknown entries are dropped. */
export function parseMigrationCommandValue(value: string): MigrationOp[] {
  const out: MigrationOp[] = []
  for (const raw of value.split(',')) {
    const op = raw.trim()
    if (KNOWN_OPS.has(op) && !out.includes(op as MigrationOp))
      out.push(op as MigrationOp)
  }
  return out
}

/** `prisma` (any launcher, global flags allowed) followed by the subcommand. */
const PRISMA_CLI: Record<'migrate-dev' | 'migrate-reset' | 'db-push', RegExp> =
  {
    'migrate-dev': /\bprisma\b[^\n]*?\bmigrate\s+dev\b/,
    'migrate-reset': /\bprisma\b[^\n]*?\bmigrate\s+reset\b/,
    'db-push': /\bprisma\b[^\n]*?\bdb\s+push\b/,
  }

/** SQL writing `_prisma_migrations` (optionally schema-qualified / quoted,
 *  quotes possibly backslash-escaped inside a `-c "…"` argument). */
const MIGRATIONS_TABLE_WRITE =
  /\b(?:update|delete\s+from|insert\s+into|truncate(?:\s+table)?|drop\s+table(?:\s+if\s+exists)?|alter\s+table(?:\s+if\s+exists)?)\s+(?:only\s+)?(?:\\?["'`]?\w+\\?["'`]?\.)?\\?["'`]?_prisma_migrations\b/i

/** A production target visible on the command line itself. */
const PRODUCTION_SIGNAL = [
  /\b(?:DATABASE_URL\w*|DIRECT_URL\w*|POSTGRES_\w*URL\w*|PRISMA_\w*URL\w*)\s*=\s*["']?[^\s"';&|]*prod/i,
  /\.env\.prod(?:uction)?\b/i,
  /\bNODE_ENV=["']?production\b/i,
]

/** Does the command line point at a production database? */
export function hasProductionSignal(command: string): boolean {
  return PRODUCTION_SIGNAL.some(re => re.test(command))
}

export interface MigrationCommandMatchOptions {
  /** Segments another detector already reports (the built-in
   *  DESTRUCTIVE_DB_COMMAND) — skipped, so one action is one crossing. */
  skipSegment?: (segment: string) => boolean
}

/** The forbidden operations one command runs, in MIGRATION_OPS order. */
export function migrationOpsIn(
  ops: readonly MigrationOp[],
  command: string,
  options: MigrationCommandMatchOptions = {}
): MigrationOp[] {
  if (!command || ops.length === 0) return []
  const segments = executingSegments(command).filter(
    seg => !(options.skipSegment?.(seg) ?? false)
  )
  if (segments.length === 0) return []
  const cli = segments.map(seg => stripQuotedLiterals(stripHeredocBodies(seg)))
  const prod = hasProductionSignal(command)
  const hit: MigrationOp[] = []
  for (const op of MIGRATION_OPS) {
    if (!ops.includes(op)) continue
    const found =
      op === 'migrations-table-write'
        ? segments.some(seg => MIGRATIONS_TABLE_WRITE.test(seg))
        : op === 'migrate-dev@production'
          ? prod && cli.some(seg => PRISMA_CLI['migrate-dev'].test(seg))
          : cli.some(seg => PRISMA_CLI[op].test(seg))
    if (found) hit.push(op)
  }
  return hit
}

/** Does `command` run an operation the `migration-command` value forbids? */
export function matchMigrationCommand(
  value: string,
  command: string,
  options: MigrationCommandMatchOptions = {}
): boolean {
  return (
    migrationOpsIn(parseMigrationCommandValue(value), command, options).length >
    0
  )
}
