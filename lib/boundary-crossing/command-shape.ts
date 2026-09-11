/**
 * LUM-751 — pure shell-command shape helpers shared by the boundary detector's
 * command matchers and the project action-rule matcher.
 *
 * The recurring false-positive shape across the taxonomy is CO-OCCURRENCE: a
 * forbidden token appears somewhere on the command line, but the segment it
 * sits in only prints, searches, reads, or authors text (a `grep` for DDL, a
 * `git log origin/main`, a `gh pr create --base main`, a commit message). The
 * canonical fix is segment scoping (the LUM-464/511 idiom): split on shell
 * separators, classify each segment by its verb, and only let EXECUTING
 * segments reach a matcher. A `bash -c '…'` wrapper is unwrapped and its inner
 * command classified the same way, so a grep hidden inside a wrapper is still a
 * grep — while `psql -c "…"` / `node -e "…"` stay executors.
 *
 * Conservative by construction: an unknown verb is treated as executing, and a
 * missed split only ever leaves MORE text in a segment (flags more, not less).
 */

/**
 * Split a compound command into its top-level invocation segments on the shell
 * separators (`;`, `&&`, `||`, `|`, newline). Quote-/subshell-aware splitting is
 * deliberately out of scope here — "good enough", and a missed split only ever
 * leaves MORE text in a segment, erring toward flagging. The detector's own
 * verb-scoped matchers (protected push, migration delete, …) use this one.
 */
export function splitCommandSegments(cmd: string): string[] {
  return cmd.split(/(?:&&|\|\||[;|\n])/)
}

/**
 * Split on the shell separators WITHOUT splitting inside a quoted literal, so a
 * `bash -c 'a && b'` wrapper survives as one segment and can be unwrapped.
 * Used by `executingSegments`.
 */
export function splitSegmentsQuoteAware(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!
    if (quote) {
      cur += c
      if (c === '\\' && quote === '"' && i + 1 < cmd.length) {
        cur += cmd[++i]!
      } else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      cur += c
      continue
    }
    if (c === '\\' && i + 1 < cmd.length) {
      cur += c + cmd[++i]!
      continue
    }
    if (c === '\n' || c === ';') {
      out.push(cur)
      cur = ''
      continue
    }
    if (c === '&' && cmd[i + 1] === '&') {
      out.push(cur)
      cur = ''
      i++
      continue
    }
    if (c === '|') {
      out.push(cur)
      cur = ''
      if (cmd[i + 1] === '|') i++
      continue
    }
    cur += c
  }
  out.push(cur)
  return out
}

/** Tokens that never carry the verb: env assignments, `!` negation and
 *  common launcher prefixes. */
const PREFIX_TOKEN =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=|!$|sudo$|env$|time$|nohup$|command$|exec$|npx$|pnpm$|bunx$|yarn$)/

/** Print / search / read tools — they execute nothing they are handed. `lumo`
 *  is Lumo's own CLI: it never runs shell text, and its `--note` / comment
 *  bodies are exactly the prose that used to self-hit (LUM-640). */
const READ_ONLY_VERBS = new Set([
  'echo',
  'printf',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'ag',
  'cat',
  'sed',
  'awk',
  'ls',
  'find',
  'head',
  'tail',
  'less',
  'more',
  'wc',
  'sort',
  'uniq',
  'tr',
  'cut',
  'diff',
  'comm',
  'test',
  '[',
  '[[',
  'true',
  'false',
  'type',
  'which',
  'file',
  'stat',
  'jq',
  'yq',
  'tee',
  'lumo',
])

/** git subcommands that read or navigate; none writes a NAMED branch/remote.
 *  `commit` is a message carrier (its `-m`/`-F` text is prose); `checkout` /
 *  `switch` / `pull` move the working copy but never write the named branch. */
const GIT_READ_ONLY = new Set([
  'log',
  'grep',
  'show',
  'diff',
  'status',
  'merge-base',
  'fetch',
  'rev-parse',
  'rev-list',
  'ls-tree',
  'ls-files',
  'ls-remote',
  'blame',
  'describe',
  'shortlog',
  'reflog',
  'name-rev',
  'cat-file',
  'cherry',
  'checkout',
  'switch',
  'pull',
  'stash',
  'worktree',
  'commit',
])

/** git subcommands that are read-only unless a mutating flag/verb follows. */
const GIT_FLAG_GATED: Record<string, RegExp> = {
  branch:
    /(?:^|\s)-(?:d|D|m|M|c|C|f|u)\b|--(?:delete|move|copy|force|set-upstream-to)\b/,
  remote: /(?:^|\s)(?:add|remove|rm|rename|set-url|prune)\b/,
  tag: /(?:^|\s)-(?:d|f|a|s)\b|--delete\b|^tag\s+[^-\s]/,
  config:
    /(?:^|\s)--(?:unset|add|replace-all|edit)\b|^config\s+(?:--\S+\s+)*[^-\s]+\s+\S/,
}

/** gh subcommands that read, or author a PR/issue/comment (prose carriers).
 *  `pr create --base main` names the PR's TARGET branch — the normal flow, not
 *  a write to main. `pr merge` is deliberately absent. */
const GH_READ_ONLY = new Set([
  'pr create',
  'pr view',
  'pr list',
  'pr diff',
  'pr checks',
  'pr status',
  'pr comment',
  'pr edit',
  'pr ready',
  'pr review',
  'issue view',
  'issue list',
  'issue create',
  'issue comment',
  'run view',
  'run list',
  'run watch',
  'repo view',
  'api',
])

/** The verb token of a segment: skip env assignments / sudo / npx etc., strip a
 *  path prefix and wrapping quotes. Returns the remaining tokens too. */
function verbOf(segment: string): { verb: string; rest: string[] } {
  const toks = segment.trim().split(/\s+/).filter(Boolean)
  let i = 0
  while (i < toks.length - 1 && PREFIX_TOKEN.test(toks[i]!)) i++
  const raw = toks[i] ?? ''
  const verb = raw.replace(/^["'$(]+/, '').replace(/^.*\//, '')
  return { verb, rest: toks.slice(i + 1) }
}

/** The body of a leading quoted literal (single-quoted, double-quoted with
 *  backslash escapes, or the `$'...'` ANSI-C form), or null when `s` does not
 *  start with a quote. */
function leadingQuotedLiteral(s: string): string | null {
  const dollar = s.startsWith("$'")
  const start = dollar ? 2 : 1
  const q = s[start - 1]
  if (q !== '"' && q !== "'") return null
  let body = ''
  for (let i = start; i < s.length; i++) {
    const c = s[i]!
    if (c === '\\' && (q === '"' || dollar) && i + 1 < s.length) {
      body += s[++i]!
      continue
    }
    if (c === q) return body
    body += c
  }
  return body
}

/** The quoted command a `bash|sh|zsh|dash -c` wrapper executes, else null. */
export function unwrapShellWrapper(segment: string): string | null {
  const { verb, rest } = verbOf(segment)
  if (!/^(?:bash|sh|zsh|dash)$/.test(verb)) return null
  const flagAt = rest.findIndex(t => /^-[a-z]*c[a-z]*$/.test(t))
  if (flagAt === -1) return null
  return leadingQuotedLiteral(rest.slice(flagAt + 1).join(' '))
}

/**
 * Whether a single segment can never execute its arguments or write a named
 * external target — print/search tools, git reads and navigation, gh reads and
 * PR/issue authoring, `git commit` (message carrier), the lumo CLI.
 */
export function isReadOnlySegment(segment: string): boolean {
  const { verb, rest } = verbOf(segment)
  if (READ_ONLY_VERBS.has(verb)) return true
  if (verb === 'git') {
    let j = 0
    while (j < rest.length && rest[j]!.startsWith('-')) j++
    const sub = rest[j] ?? ''
    if (GIT_READ_ONLY.has(sub)) return true
    const gate = GIT_FLAG_GATED[sub]
    if (gate) return !gate.test(rest.slice(j).join(' '))
    return false
  }
  if (verb === 'gh') {
    const pair = `${rest[0] ?? ''} ${rest[1] ?? ''}`.trim()
    return GH_READ_ONLY.has(pair) || GH_READ_ONLY.has(rest[0] ?? '')
  }
  return false
}

/**
 * The segments of a command that actually EXECUTE something: read-only segments
 * are dropped and `bash -c '…'` wrappers are unwrapped (recursively, bounded)
 * so the inner command is classified segment by segment. Trimmed, non-empty.
 */
export function executingSegments(cmd: string, depth = 0): string[] {
  const out: string[] = []
  for (const raw of splitSegmentsQuoteAware(cmd)) {
    const seg = raw.trim()
    if (!seg) continue
    const inner = depth < 3 ? unwrapShellWrapper(seg) : null
    if (inner != null) {
      out.push(...executingSegments(inner, depth + 1))
      continue
    }
    if (isReadOnlySegment(seg)) continue
    out.push(seg)
  }
  return out
}
