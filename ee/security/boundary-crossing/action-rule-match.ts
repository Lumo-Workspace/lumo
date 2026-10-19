/**
 * LUM-751 — segment-scoped, prose-stripped matcher for project action rules
 * (`cmd-substr` predicates compiled from CLAUDE.md / AGENTS.md, LUM-590).
 *
 * `matchCmdSubstr` was a bare `command.includes(value)` on the raw line. In
 * prod, 52 of 55 OPEN crossings were PROJECT_RULE_VIOLATION and ~96% of human
 * dispositions were FALSE_POSITIVE — `gh pr create --base main`, `git log
 * origin/main`, a PR body / commit message / `lumo crossing explain --note`
 * quoting a rule keyword. Same idiom as `matchProtectedPush` (LUM-464):
 *
 *   1. strip prose — heredoc bodies + quoted-literal contents (LUM-466
 *      `stripProse`), so a keyword inside `-m` / `--body` / `--note` is gone;
 *   2. split into shell segments and keep only the EXECUTING ones
 *      (command-shape: read-only verbs and PR-authoring segments dropped,
 *      `bash -c '…'` unwrapped);
 *   3. the predicate must appear inside one of those segments.
 *
 * LUM-1236: and it must appear as a whole word — `rm` is not inside `format`,
 * `confirm` or `rmdir` — and a needle too generic to name a violation on its
 * own (two characters or fewer, or a bare common verb like `rm` / `mv` /
 * `git rm`) never matches at all: such a rule is about WHAT the verb acts on,
 * which the substring cannot see (a path rule compiles to `path-delete`).
 *
 * Conservative: an unknown verb counts as executing, so a genuinely new write
 * verb is still caught; only the recognised read/author shapes are exempt.
 */
import { stripHeredocBodies, stripQuotedLiterals } from './action-confirm'
import { executingSegments } from '@/lib/boundary-crossing/command-shape'

/** Verbs that are everyday work on their own — a rule naming only one of
 *  them forbids nothing in particular. */
const BARE_VERBS = new Set([
  'rm',
  'mv',
  'cp',
  'ln',
  'cd',
  'ls',
  'cat',
  'sed',
  'awk',
  'find',
  'grep',
  'echo',
  'touch',
  'mkdir',
  'rmdir',
  'unlink',
  'chmod',
  'chown',
  'kill',
  'git',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'node',
  'python',
  'python3',
  'bash',
  'sh',
  'sudo',
  'curl',
  'make',
  'docker',
  'delete',
  'remove',
  'git rm',
  'git mv',
  'git add',
  'git clean',
])

/**
 * A `cmd-substr` needle that cannot name a violation by itself: empty, at most
 * two characters, or a bare common verb, optionally with one-letter flags
 * (`rm -f`) but no operand. A recursive flag (`rm -rf`, `rm -r`) is kept: a
 * "never run rm -rf" rule names a specific shape on its own. Pure.
 */
export function isUnsafeCmdNeedle(value: string): boolean {
  const needle = value.trim().replace(/\s+/g, ' ')
  if (needle.length <= 2) return true
  const withoutFlags = needle
    .split(' ')
    .filter(t => !/^-[a-qs-zA-QS-Z]$/.test(t))
    .join(' ')
  return BARE_VERBS.has(withoutFlags.toLowerCase())
}

const WORD = /[A-Za-z0-9_]/

/** `needle` occurs in `hay` with no word character glued to either end that
 *  is itself a word character (`rm` ≠ `format`, `--force` ⊂ `--force-x`). */
export function containsWord(hay: string, needle: string): boolean {
  const first = WORD.test(needle[0] ?? '')
  const last = WORD.test(needle[needle.length - 1] ?? '')
  let from = 0
  for (;;) {
    const i = hay.indexOf(needle, from)
    if (i === -1) return false
    const before = hay[i - 1] ?? ''
    const after = hay[i + needle.length] ?? ''
    if ((!first || !WORD.test(before)) && (!last || !WORD.test(after)))
      return true
    from = i + 1
  }
}

export function matchActionRule(value: string, command: string): boolean {
  const needle = value.trim()
  if (!needle || isUnsafeCmdNeedle(needle)) return false
  // Order matters: segment + unwrap wrappers first (a `bash -c "…"` body must
  // survive to be classified; LUM-772 — a heredoc body stays attached to the
  // segment that opens it, so a `git commit -F - <<EOF` message is dropped
  // with its carrier and never splits into segments of its own), then heredoc
  // bodies and quoted literals are emptied per executing segment so `-m` /
  // `--body` / `--note` text never matches.
  return executingSegments(command).some(seg =>
    containsWord(stripQuotedLiterals(stripHeredocBodies(seg)), needle)
  )
}
