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
 * Conservative: an unknown verb counts as executing, so a genuinely new write
 * verb is still caught; only the recognised read/author shapes are exempt.
 */
import { stripHeredocBodies, stripQuotedLiterals } from './action-confirm'
import { executingSegments } from '@/lib/boundary-crossing/command-shape'

export function matchActionRule(value: string, command: string): boolean {
  const needle = value.trim()
  if (!needle) return false
  // Order matters: segment + unwrap wrappers first (a `bash -c "…"` body must
  // survive to be classified; LUM-772 — a heredoc body stays attached to the
  // segment that opens it, so a `git commit -F - <<EOF` message is dropped
  // with its carrier and never splits into segments of its own), then heredoc
  // bodies and quoted literals are emptied per executing segment so `-m` /
  // `--body` / `--note` text never matches.
  return executingSegments(command).some(seg =>
    stripQuotedLiterals(stripHeredocBodies(seg)).includes(needle)
  )
}
