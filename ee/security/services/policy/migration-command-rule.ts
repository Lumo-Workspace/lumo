/**
 * LUM-1236 follow-up — "never run these migration commands" shape guard for
 * the policy compiler.
 *
 * Why it exists: CLAUDE.md's Production line ("use only `prisma migrate
 * deploy` — never `migrate dev`, `db push`, `migrate reset`, or direct edits
 * to `_prisma_migrations`") compiled to a deterministic, blocking rule — until
 * the lum1236 recompile, where the model reworded it ("In production: use only
 * prisma migrate deploy — never …") and gave it no predicate: NO_CHECKER, and
 * the dev line's "Never … direct-UPDATE `_prisma_migrations`" with it. The
 * prompt had just told the model not to emit bare verbs; it answered by
 * emitting nothing. Like the push (LUM-772) and delete-path (LUM-1236) guards,
 * the compiler now derives the check from the text instead of trusting the
 * model: the rule names its commands literally.
 *
 * A rule qualifies when a PROHIBITION clause ("never …", "do not …", "禁止 …")
 * names at least one of: `migrate dev`, `migrate reset`, `db push`, or an edit
 * of `_prisma_migrations`. Only the operations inside that clause are taken —
 * "schema changes are applied via `prisma migrate dev`. Never `prisma migrate
 * reset` …" forbids reset, not dev. A rule qualified by production
 * ("in production", "prod") forbids `migrate dev` only against production
 * (`migrate-dev@production`, see the matcher) — the same file sanctions it in
 * dev. Pure, no I/O.
 */
import type { MigrationOp } from '@/ee/security/boundary-crossing/migration-command-match'
import type { RawPolicyRule } from './types'

/** Clause-opening prohibition wording (the forbidden part follows it). */
const PROHIBITION =
  /\b(?:never|do\s+not|don'?t|must\s+not|may\s+not|not|forbidden|prohibited)\b|禁止|严禁|不要|不得|不能|不准|不可|勿|别/gi

/** Clause / sentence boundaries — a prohibition reaches to the next one. An
 *  ellipsis is elision, not an end: the model writes "never `migrate dev`
 *  ... or direct edits to `_prisma_migrations`". */
const CLAUSE_END = /(?:(?<!\.)[.;!?。；！？](?!\.)(?:\s|$)|\n|\(\w\)\s)/

const EDIT_WORD =
  /\b(?:edit\w*|updat\w*|modif\w*|writ\w*|chang\w*|delet\w*|insert\w*|alter\w*|truncat\w*|touch\w*|tamper\w*)\b|修改|改动|更新|写入|删除|直接改|手改/i

/** Production qualifier in the rule text. */
const PRODUCTION = /\bprod(?:uction)?\b|生产/i

function normalise(text: string): string {
  return text.replace(/[`*]/g, '').replace(/\s+/g, ' ')
}

/** The text of every prohibition clause: from the marker to the clause end. */
export function prohibitedClauses(text: string): string[] {
  const t = normalise(text)
  const out: string[] = []
  for (const m of t.matchAll(PROHIBITION)) {
    const rest = t.slice((m.index ?? 0) + m[0].length)
    const end = rest.search(CLAUSE_END)
    out.push(end === -1 ? rest : rest.slice(0, end))
  }
  return out
}

/** The migration operations a rule text forbids, in a stable order. */
export function forbiddenMigrationOps(text: string): MigrationOp[] {
  const clauses = prohibitedClauses(text)
  if (clauses.length === 0) return []
  const ops = new Set<MigrationOp>()
  const prodOnly = PRODUCTION.test(text)
  for (const c of clauses) {
    if (/\bmigrate\s+dev\b/i.test(c))
      ops.add(prodOnly ? 'migrate-dev@production' : 'migrate-dev')
    if (/\bmigrate\s+reset\b/i.test(c)) ops.add('migrate-reset')
    if (/\bdb\s+push\b/i.test(c)) ops.add('db-push')
    if (/_prisma_migrations\b/i.test(c) && EDIT_WORD.test(c))
      ops.add('migrations-table-write')
  }
  const order: MigrationOp[] = [
    'migrate-dev',
    'migrate-dev@production',
    'migrate-reset',
    'db-push',
    'migrations-table-write',
  ]
  return order.filter(op => ops.has(op))
}

export interface MigrationCommandRuleShape {
  /** The forbidden operations — the `migration-command` predicate value. */
  ops: MigrationOp[]
}

/**
 * Is this an action rule forbidding migration commands whose check the
 * compiler should derive? Null when it is not one, or when the model gave it
 * a predicate of another kind (a path glob, a diff regex). A missing
 * predicate, a `cmd-substr` (it can name only one command of the list, and
 * cannot see SQL inside quotes) or a stored `migration-command` is replaced.
 * The model's polarity is not consulted: the prohibition clause in the text is
 * the evidence, and a model that misread "use only X — never Y" as an
 * obligation is the failure being guarded.
 */
export function migrationCommandRuleShape(
  rule: Pick<RawPolicyRule, 'text' | 'kind' | 'predicate'>
): MigrationCommandRuleShape | null {
  if (rule.kind !== 'action') return null
  const p = rule.predicate
  if (p != null && p.type !== 'cmd-substr' && p.type !== 'migration-command')
    return null
  const ops = forbiddenMigrationOps(rule.text)
  return ops.length > 0 ? { ops } : null
}
