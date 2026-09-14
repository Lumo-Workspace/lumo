/**
 * LUM-772 — target-aware matcher for the `push-target` policy predicate.
 *
 * A compiled "never push to main / develop" rule used to carry a
 * `cmd-substr: "git push"` predicate, which reads as "any push at all is a
 * violation" — every feature-branch push in prod tripped it (3 HIGH
 * PROJECT_RULE_VIOLATION rows in one LUM-771 session, all FALSE_POSITIVE). The
 * built-in PUSH_TO_PROTECTED_BRANCH detector was already scoped to the push's
 * own destination (LUM-464); this module gives the project-rule path the same
 * semantics, parameterised by the branches the rule names:
 *
 *   git push [global-opts] push [opts] <remote> [<src>:]<dst> …
 *
 * Only the DESTINATION side of each refspec is judged (`main:feature` pushes
 * to `feature`; `HEAD:main` and `feature:develop` push to a protected name).
 * A bare `git push` / `git push origin` with no refspec is NOT judged — its
 * target is unknowable from the command text (same tradeoff as the built-in).
 * `--all` / `--mirror` push every branch, so they count as hitting.
 *
 * Segment-scoped and prose-carrier-aware (`executingSegments`): a push quoted
 * in a `lumo crossing explain --note`, a commit message (inline or heredoc),
 * a PR body or an echo never reaches the parser, and `gh pr create --base
 * main` is PR authoring, not a push. Pure — no I/O.
 */
import { executingSegments } from './command-shape'

/** Push options that consume the NEXT token as their value. */
const PUSH_OPTS_WITH_VALUE = new Set([
  '-o',
  '--push-option',
  '--receive-pack',
  '--exec',
  '--repo',
])

/** Git global options (before the verb) that consume the next token. */
const GIT_GLOBAL_OPTS_WITH_VALUE = new Set([
  '-c',
  '-C',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--super-prefix',
  '--config-env',
  '--attr-source',
])

/** A push that writes EVERY local branch — treated as hitting any target. */
const PUSH_ALL_FLAGS = new Set(['--all', '--mirror', '--branches'])

/** The git binary as a shell token: bare, path-prefixed, or wrapped by a
 *  leading `(` / `$(` / quote. */
const GIT_TOKEN = /^(?:\$?\()?["']?(?:\S*\/)?git$/

/** Strip a token's wrapping quotes / trailing `)` so refspecs compare cleanly. */
function bare(tok: string): string {
  return tok.replace(/^["']+/, '').replace(/["')]+$/, '')
}

/** The destination branch of one refspec argument, or null for a non-branch
 *  form (a tag-ish / empty value). `+` (force) and `refs/heads/` are dropped;
 *  `:main` (a remote delete) resolves to `main`. */
function refspecDestination(arg: string): string | null {
  let ref = bare(arg)
  if (ref.startsWith('+')) ref = ref.slice(1)
  const colon = ref.indexOf(':')
  if (colon !== -1) ref = ref.slice(colon + 1)
  ref = ref.replace(/^refs\/heads\//, '')
  return ref.length > 0 ? ref : null
}

/**
 * The branch names one shell segment pushes TO, `'ALL'` when it pushes every
 * branch (`--all` / `--mirror`), or `[]` when the segment is not a `git push`
 * or names no destination (bare push → unknowable → not judged).
 */
export function pushDestinations(segment: string): string[] | 'ALL' {
  const toks = segment.trim().split(/\s+/).filter(Boolean)
  const gitAt = toks.findIndex(t => GIT_TOKEN.test(t))
  if (gitAt < 0) return []
  let i = gitAt + 1
  while (i < toks.length && toks[i]!.startsWith('-')) {
    if (GIT_GLOBAL_OPTS_WITH_VALUE.has(toks[i]!)) i += 2
    else i += 1
  }
  if (toks[i] !== 'push') return []
  const positionals: string[] = []
  let endOfOptions = false
  for (let j = i + 1; j < toks.length; j++) {
    const tok = toks[j]!
    if (!endOfOptions) {
      if (tok === '--') {
        endOfOptions = true
        continue
      }
      if (PUSH_ALL_FLAGS.has(tok)) return 'ALL'
      if (tok.startsWith('-')) {
        if (PUSH_OPTS_WITH_VALUE.has(tok)) j += 1
        continue
      }
    }
    positionals.push(tok)
  }
  // positionals[0] is the remote (or a URL); the refspecs follow it.
  const out: string[] = []
  for (const arg of positionals.slice(1)) {
    const dst = refspecDestination(arg)
    if (dst != null) out.push(dst)
  }
  return out
}

/** Parse a `push-target` predicate value (`main,develop`) into branch names. */
export function parsePushTargetValue(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,\s]+/)
        .map(b => b.trim())
        .filter(b => b.length > 0)
    ),
  ]
}

/**
 * Does `command` execute a `git push` whose OWN destination is one of the
 * predicate's branches? Read-only / prose-carrier segments are dropped first,
 * heredoc bodies (authored text) are ignored, and `bash -c '…'` wrappers are
 * unwrapped so a wrapped real push is still caught.
 */
export function matchPushTarget(value: string, command: string): boolean {
  const branches = new Set(parsePushTargetValue(value))
  if (branches.size === 0) return false
  // A heredoc body rides with the segment that opens it (command-shape): a
  // `git commit -F - <<EOF` message is dropped with its carrier, while a
  // `bash <<EOF` body is parsed — its first `git` token decides.
  return executingSegments(command).some(seg => {
    const dst = pushDestinations(seg)
    return dst === 'ALL' || dst.some(d => branches.has(d))
  })
}
