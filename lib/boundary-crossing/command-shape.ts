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
 *
 * LUM-772: the built-in command matchers run on these segments too, with
 * `keepGit` — every `git …` segment counts as executing for them (a
 * `git commit` IS the action for HOOK_BYPASS, and commit-message prose is the
 * LUM-466 confirmation step's call, not this module's), while the print /
 * search / lumo / gh-authoring carriers are dropped deterministically, so a
 * `lumo crossing explain --note "…"` quoting a forbidden command never reaches
 * a matcher at all.
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

/** A heredoc operator and its delimiter (`<<EOF`, `<<-EOF`, `<<'EOF'`). */
const HEREDOC_OP = /^<<-?\s*(['"]?)([A-Za-z_]\w*)\1/

/**
 * Split on the shell separators WITHOUT splitting inside a quoted literal, so a
 * `bash -c 'a && b'` wrapper survives as one segment and can be unwrapped.
 * Used by `executingSegments`.
 *
 * LUM-772: a heredoc BODY stays attached to the segment that opens it, so the
 * intro's verb decides the whole unit — `cat > f <<EOF … EOF` is authored text
 * and is dropped as one read-only segment (its lines never become segments of
 * their own), while `bash <<EOF` / `psql <<EOF` keep their body in an
 * executing segment. An unterminated heredoc falls back to plain line
 * splitting (nothing is swallowed).
 */
export function splitSegmentsQuoteAware(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  // A heredoc announced on the current line: its delimiter, and the index in
  // `out` of the segment that owns it once a separator has pushed that
  // segment (null while the owner is still `cur`).
  let heredoc: string | null = null
  let owner: number | null = null
  const push = () => {
    out.push(cur)
    cur = ''
    if (heredoc !== null && owner === null) owner = out.length - 1
  }
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]!
    if (quote) {
      cur += c
      if (c === '\\' && quote === '"' && i + 1 < cmd.length) {
        cur += cmd[++i]!
      } else if (c === quote) quote = null
      i++
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      cur += c
      i++
      continue
    }
    if (c === '\\' && i + 1 < cmd.length) {
      cur += c + cmd[++i]!
      i++
      continue
    }
    if (c === '<' && cmd[i + 1] === '<' && heredoc === null) {
      const m = cmd.slice(i).match(HEREDOC_OP)
      if (m) {
        heredoc = m[2]!
        cur += m[0]
        i += m[0].length
        continue
      }
    }
    if (c === '\n') {
      if (heredoc !== null) {
        // Body mode: consume whole lines up to and including the terminator.
        const lines = cmd.slice(i + 1).split('\n')
        const body: string[] = []
        let consumed = 0
        let found = false
        for (const line of lines) {
          consumed += line.length + 1
          body.push(line)
          if (line.trim() === heredoc) {
            found = true
            break
          }
        }
        const delimiter = heredoc
        heredoc = null
        if (found) {
          const text = '\n' + body.join('\n')
          if (owner !== null) out[owner] = out[owner]!.trimEnd() + text
          else cur = cur.trimEnd() + text
          owner = null
          push()
          i = Math.min(i + 1 + consumed, cmd.length)
          continue
        }
        // Unterminated `<<${delimiter}`: not a heredoc after all — plain lines.
        void delimiter
        owner = null
      }
      push()
      i++
      continue
    }
    if (c === ';') {
      push()
      i++
      continue
    }
    if (c === '&' && cmd[i + 1] === '&') {
      push()
      i += 2
      continue
    }
    if (c === '|') {
      push()
      i += cmd[i + 1] === '|' ? 2 : 1
      continue
    }
    cur += c
    i++
  }
  out.push(cur)
  return out
}

/** `find` executes or deletes what it matches when given one of these —
 *  `-exec rm {} +`, `-delete` — so such a segment is NOT a read-only search. */
const FIND_MUTATING_FLAG = /(?:^|\s)-(?:exec|execdir|ok|okdir|delete)\b/

/** Tokens that never carry the verb: env assignments, `!` negation, common
 *  launcher prefixes, and the control-flow keywords that INTRODUCE a command.
 *
 *  LUM-802: `then` / `do` / `else` / `elif` / `if` / `while` / `until` are each
 *  followed by a whole command, so the verb is the next token — without this,
 *  `then echo "…"` read as an unknown verb (executing) while a bare
 *  `echo "…"` was dropped, and the built-in matchers (which, unlike
 *  `matchActionRule`, do not strip quoted literals) saw the prose of every
 *  `if <bad thing>; then echo "<text naming the bad thing>"` monitor script.
 *  Skipping the keyword only ever EXPOSES the real verb: `then rm -rf …`
 *  resolves to `rm` and stays executing, so nothing an action matcher used to
 *  catch is swallowed.
 *
 *  Deliberately NOT here:
 *  - `done` / `fi` / `esac` close a block and are followed by nothing. They
 *    form single-token segments, which the `i < toks.length - 1` guard below
 *    never skips anyway; leaving them unknown keeps them executing (harmless —
 *    a lone keyword matches nothing) rather than teaching the classifier that
 *    a bare word is safe.
 *  - `for` / `case` / `in` are followed by a variable name or a word list, not
 *    a command (`for f in $(ls)`), so skipping them would promote a non-verb
 *    token to verb. Both classify as executing either way, so there is nothing
 *    to gain and a misread to lose. */
const PREFIX_TOKEN =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=|!$|sudo$|env$|time$|nohup$|command$|exec$|npx$|pnpm$|bunx$|yarn$|if$|elif$|then$|else$|while$|until$|do$)/

/** Print / search / read tools — they execute nothing they are handed. `lumo`
 *  is Lumo's own CLI: it never runs shell text, and its `--note` / comment
 *  bodies are exactly the prose that used to self-hit (LUM-640). */
const READ_ONLY_VERBS = new Set([
  'echo',
  'pwd',
  'printf',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'ag',
  'ast-grep',
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

/** `VAR=$(cmd …` — an assignment whose value is a command substitution. The
 *  verb is the substituted COMMAND, not the assignment: LUM-795's prod case is
 *  `DESC=$(cat <<'EOF' … EOF)`, a `lumo task create -d` description built from
 *  a heredoc. Without this the whole token reads as a plain env assignment, the
 *  segment's verb reads as the heredoc operator, and the authored text reaches
 *  the matchers — the carrier gap LUM-772 closed for `lumo` / `gh`. */
const ASSIGN_SUBST = /^[A-Za-z_][A-Za-z0-9_]*=\$?\(+/

/** The verb token of a segment: skip env assignments / sudo / npx etc., strip a
 *  path prefix and wrapping quotes. Returns the remaining tokens too. */
function verbOf(segment: string): { verb: string; rest: string[] } {
  const toks = segment.trim().split(/\s+/).filter(Boolean)
  // `VAR=$(cmd …`: look INSIDE the substitution. Bounded — each unwrap drops the
  // matched prefix, so the token strictly shrinks.
  const subst = toks[0]?.match(ASSIGN_SUBST)
  if (subst) {
    const head = toks[0]!.slice(subst[0].length)
    const inner = head.length > 0 ? [head, ...toks.slice(1)] : toks.slice(1)
    if (inner.length > 0) return verbOf(inner.join(' '))
  }
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

/** Options for {@link isReadOnlySegment} / {@link executingSegments}. */
export interface SegmentScopeOptions {
  /**
   * LUM-772: treat EVERY `git …` segment as executing. For the built-in
   * command matchers a git invocation is itself the action under test (a
   * `git commit -n` is a hook bypass; a `git push` may target main), and the
   * commit-message / heredoc prose they carry is judged by the LUM-466
   * confirmation step — so only the non-git prose carriers (echo / grep / cat
   * / lumo / gh authoring …) are dropped for them. Off by default: the
   * project-rule matcher keeps the LUM-751 git read / navigation exemptions.
   */
  keepGit?: boolean
}

/**
 * Whether a single segment can never execute its arguments or write a named
 * external target — print/search tools, git reads and navigation, gh reads and
 * PR/issue authoring, `git commit` (message carrier), the lumo CLI.
 */
export function isReadOnlySegment(
  segment: string,
  options: SegmentScopeOptions = {}
): boolean {
  const { verb, rest } = verbOf(segment)
  // `find … -exec …` / `-delete` runs or removes what it finds — an executor.
  if (verb === 'find') return !FIND_MUTATING_FLAG.test(rest.join(' '))
  if (READ_ONLY_VERBS.has(verb)) return true
  if (verb === 'git') {
    if (options.keepGit) return false
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
export function executingSegments(
  cmd: string,
  options: SegmentScopeOptions = {},
  depth = 0
): string[] {
  const out: string[] = []
  for (const raw of splitSegmentsQuoteAware(cmd)) {
    const seg = raw.trim()
    if (!seg) continue
    const inner = depth < 3 ? unwrapShellWrapper(seg) : null
    if (inner != null) {
      out.push(...executingSegments(inner, options, depth + 1))
      continue
    }
    if (isReadOnlySegment(seg, options)) continue
    out.push(seg)
  }
  return out
}
