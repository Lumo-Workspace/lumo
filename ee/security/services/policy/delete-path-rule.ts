/**
 * LUM-1236 — "never delete files in <path>" shape guard for the policy
 * compiler.
 *
 * Why it exists: the LLM compiler turned CLAUDE.md's "Never delete files in
 * prisma/migrations/" into a path-blind `cmd-substr: "rm"` (12 HIGH false
 * positives in three days: `format`, `confirm`, `rmdir`, `git rm` of
 * unrelated files). A deletion prohibition is only ever about WHICH files go,
 * so — like the push guard (LUM-772) — the compiler rewrites such rules
 * deterministically instead of trusting the model's predicate:
 *
 *   - the predicate becomes `path-delete` over the paths the text names,
 *     judged on the operands of the delete (lib/boundary-crossing/path-delete);
 *   - when every named path lies under prisma/migrations the rule is mapped to
 *     the built-in MIGRATION_FILE_DELETED, whose detector reads exactly those
 *     deletes — the project rule then adds no second crossing of its own
 *     (crossing-detectors `isCoveredByBuiltinDetector`).
 *
 * Only rules whose model predicate is missing or path-blind are rewritten: a
 * compound rule the model gave a specific command (`prisma migrate reset`)
 * keeps it. Pure, no I/O.
 */
import {
  normaliseProtectedPath,
  pathsCoveredByMigrationBuiltin,
} from '@/lib/boundary-crossing/path-delete'
import { isUnsafeCmdNeedle } from '@/ee/security/boundary-crossing/action-rule-match'
import { isObligationText } from './rule-polarity'
import type { RawPolicyRule } from './types'

/** Wording that forbids (the rule must be a prohibition). */
const PROHIBITION =
  /\b(?:never|not|don'?t|do\s+not|must\s+not|forbidden|prohibited|no)\b|禁止|严禁|不要|不得|不能|不可|不准|勿|别/i

/** Wording that names a deletion / move. */
const DELETE_WORD =
  /\b(?:delet\w*|remov\w*|rm|unlink\w*|renam\w*|mov(?:e|es|ed|ing)|eras\w*|wip(?:e|es|ed|ing))\b|删除|删掉|删|移除|移动|改名|重命名|清空/i

/** A repository path the text names: at least one `/`, no URL scheme. */
const PATH_TOKEN =
  /(?<![\w.:/-])((?:\.{1,2}\/)?[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@*-]+)*\/?)(?![\w/])/g

/** Slash words that are prose, not paths. */
const NOT_A_PATH = new Set([
  'and/or',
  'or/and',
  'either/or',
  'read/write',
  'input/output',
  'i/o',
  'feat/fix/chore',
])

/** The paths a rule text names, normalised, in text order, unique. Backticked
 *  spans are preferred when there are any. */
export function protectedPathsFromText(text: string): string[] {
  const ticked = [...text.matchAll(/`([^`]+)`/g)].map(m => m[1]!)
  const sources = ticked.some(t => t.includes('/')) ? ticked : [text]
  const out: string[] = []
  for (const src of sources) {
    for (const m of src.matchAll(PATH_TOKEN)) {
      const raw = m[1]!
      if (!raw.includes('/') || NOT_A_PATH.has(raw.toLowerCase())) continue
      if (/^\.{0,2}\/?$/.test(raw)) continue
      const p = normaliseProtectedPath(raw)
      if (p && !out.includes(p)) out.push(p)
    }
  }
  return out
}

export interface DeletePathRuleShape {
  /** The protected paths — the `path-delete` predicate value. */
  paths: string[]
  /** Every path is under prisma/migrations: map to MIGRATION_FILE_DELETED. */
  coveredByBuiltin: boolean
}

/**
 * Is this rule a "never delete / rename files in <path>" prohibition whose
 * predicate should be the path-scoped `path-delete`? Null when it is not one,
 * names no path, or the model already gave it a specific command predicate.
 */
export function deletePathRuleShape(
  rule: Pick<
    RawPolicyRule,
    'text' | 'kind' | 'predicate' | 'polarity' | 'mappedCategory'
  >
): DeletePathRuleShape | null {
  if (rule.kind !== 'action') return null
  // A sensitive-path glob is its own detector (LUM-736 / LUM-963) — keep it.
  if (/^SENSITIVE_PATH_/.test(rule.mappedCategory ?? '')) return null
  if (rule.polarity === 'require' || isObligationText(rule.text)) return null
  if (!PROHIBITION.test(rule.text) || !DELETE_WORD.test(rule.text)) return null
  const p = rule.predicate
  const pathBlind =
    p == null ||
    p.type === 'path-glob' ||
    p.type === 'path-delete' ||
    (p.type === 'cmd-substr' &&
      (isUnsafeCmdNeedle(p.value) ||
        /^(?:rm|mv|unlink|rmdir|git\s+(?:rm|mv)|find)\b/.test(p.value.trim())))
  if (!pathBlind) return null
  const paths = protectedPathsFromText(rule.text)
  if (paths.length === 0) return null
  return { paths, coveredByBuiltin: pathsCoveredByMigrationBuiltin(paths) }
}
