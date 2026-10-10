/**
 * LUM-772 — push-prohibition shape guard for the policy compiler.
 *
 * Why it exists: the LLM compiler turned CLAUDE.md's "Never push to main or
 * develop directly" into a deterministic `cmd-substr: "git push"` predicate —
 * target-blind, so every feature-branch push was a HIGH PROJECT_RULE_VIOLATION
 * (LUM-771: three false positives in one session, `main` appearing only in a
 * sibling `gh pr create --base main`). A push prohibition is only ever about
 * WHERE the push lands, so the compiler rewrites such rules deterministically:
 *
 *   - mapped to the built-in PUSH_TO_PROTECTED_BRANCH and naming only branches
 *     the built-in already guards (main / master / develop) → the predicate is
 *     DROPPED: the built-in detector (target-scoped since LUM-464) is the single
 *     source, no duplicate PROJECT_RULE_VIOLATION per real violation;
 *   - otherwise → a `push-target` predicate over the branches the rule text
 *     names, judged by `matchPushTarget` on the push's own destination.
 *
 * Like `rule-polarity` (LUM-770), this is a second, deterministic opinion on
 * top of the model's classification — the observed failure IS the model
 * emitting a target-blind substring. Pure, no I/O.
 */
import { isObligationText } from './rule-polarity'

/** The branches the built-in PUSH_TO_PROTECTED_BRANCH matcher guards. */
export const BUILTIN_PROTECTED_BRANCHES: ReadonlySet<string> = new Set([
  'main',
  'master',
  'develop',
])

/** Branch names a rule text can name. Deliberately a small, well-known set —
 *  a generic "any backticked token" extraction would turn `_prisma_migrations`
 *  in a migration rule into a branch. Matched as whole words, an `origin/`
 *  prefix allowed, case-insensitive. */
const KNOWN_BRANCH_NAMES = [
  'main',
  'master',
  'develop',
  'development',
  'trunk',
  'release',
  'production',
  'staging',
] as const

const BRANCH_MENTION = new RegExp(
  `(?<![\\w-])(?:origin/)?(${KNOWN_BRANCH_NAMES.join('|')})(?![\\w-])`,
  'gi'
)

/** Does the text talk about a git push (not a `prisma db push`)? */
const PUSH_WORD = /\bpush(?:es|ed|ing)?\b|推送|推到/i
const DB_PUSH = /\b(?:db|prisma)\s+push\b/i

/**
 * The branch names a rule text names, in text order, lower-cased, unique.
 * `[]` when it names none of the known ones.
 */
export function protectedBranchesFromText(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(BRANCH_MENTION)) {
    const name = (m[1] ?? '').toLowerCase()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/** The slice of a raw compiled rule the push-shape guard reads. */
export interface PushRuleInput {
  text: string
  kind: 'action' | 'code'
  mappedCategory?: string | undefined
}

export interface PushRuleShape {
  /** The branches the rule protects — from the text, or the built-in set when
   *  the rule is mapped to PUSH_TO_PROTECTED_BRANCH and names none. */
  branches: string[]
  /** Mapped to the built-in AND every named branch is one the built-in guards
   *  → the built-in detector alone covers the rule (drop the predicate). */
  coveredByBuiltin: boolean
}

/**
 * Is this rule a "never push to <branch>" prohibition? Returns the branches it
 * protects, or null when it is not push-shaped: an obligation, a `db push`
 * rule, a push rule that names no branch (e.g. "never force-push" — its own
 * predicate is left alone), or a code rule.
 */
export function pushRuleShape(rule: PushRuleInput): PushRuleShape | null {
  if (rule.kind !== 'action') return null
  if (isObligationText(rule.text)) return null
  const mapped = rule.mappedCategory === 'PUSH_TO_PROTECTED_BRANCH'
  const named = protectedBranchesFromText(rule.text)
  const pushText = PUSH_WORD.test(rule.text) && !DB_PUSH.test(rule.text)
  if (!mapped && !(pushText && named.length > 0)) return null
  const branches =
    named.length > 0 ? named : mapped ? [...BUILTIN_PROTECTED_BRANCHES] : []
  if (branches.length === 0) return null
  return {
    branches,
    coveredByBuiltin:
      mapped && branches.every(b => BUILTIN_PROTECTED_BRANCHES.has(b)),
  }
}
