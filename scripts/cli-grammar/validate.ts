/**
 * LUM-413: BFCL-style AST static validator. Given a raw `lumo …` segment and
 * the grammar snapshot, judge whether the invocation is *structurally*
 * constructible: known subcommand path, declared flags, legal enum values.
 *
 * Scope boundary (deliberate): this validator never judges whether a call
 * SHOULD have been made — redundancy/ceremony is the attribution layer's
 * job (attribute.ts), and runtime outcomes (auth, server errors) are the
 * output classifier's. Pure function, no I/O.
 */
import type { CliGrammar, GrammarCommand, GrammarFlag } from './grammar'
import { GLOBAL_FLAGS, ROOT_FLAGS } from './grammar'
import { tokenize } from './parse'

export type AstVerdictKind =
  | 'valid'
  | 'unknown-command'
  | 'unknown-flag'
  | 'illegal-enum'

export interface AstVerdict {
  kind: AstVerdictKind
  /** Longest grammar path matched ("" when nothing matched). */
  commandPath: string
  /** The offending token / value, when kind !== 'valid'. */
  offending: string | null
  detail: string | null
}

/** Tokens that end flag/positional parsing (shell redirections). */
const isRedirection = (t: string) =>
  t.startsWith('>') || t.startsWith('<') || t === '2>' || t === '2>&1'

/** Values we can't statically judge (shell expansion, globs, substitution). */
const isDynamicValue = (v: string) =>
  /[$`*?{]/.test(v) || v.startsWith('~') || v === ''

const looksLikeFlag = (t: string) => /^--?[A-Za-z]/.test(t)

/**
 * Fold an enum token the way the CLI runtime normalizers do (LUM-420):
 * status-like commands lowercase/uppercase before validating, and the
 * status/agent normalizers additionally unify `-`/`_`/space separators
 * (normalizeStatus accepts `in-progress`, normalizeAgent accepts
 * `claude_code`). Applied only when the flag's help text carries the
 * `case-insensitive` marker (GrammarFlag.enumCaseInsensitive).
 */
const foldEnumToken = (v: string) => v.toLowerCase().replace(/[\s_]+/g, '-')

/**
 * A flag-shaped token we are willing to pass judgment on. Tokens carrying
 * shell metacharacters, CJK, slashes etc. are free-text noise (doc prose,
 * truncated quoted bodies), not flag attempts — the validator skips them
 * rather than calling them hallucinations.
 */
const isCleanFlagToken = (t: string) =>
  /^--?[A-Za-z][A-Za-z0-9-]*(=.*)?$/.test(t)

/** Same idea for subcommand tokens (quote debris like `status\`` is noise). */
const isCleanWordToken = (t: string) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(t)

/**
 * Whether reaching this node without a further token is a construction error.
 * A parent that carries its own action is callable bare (`lumo plan`), so only
 * a pure routing node (`lumo task`) genuinely requires a subcommand — LUM-706.
 * `isInvokable` is absent on pre-LUM-706 grammar snapshots; undefined folds to
 * the old behavior.
 */
const needsSubcommand = (node: GrammarCommand | null | undefined) =>
  node?.hasSubcommands === true && !node.isInvokable

interface ResolvedPath {
  node: GrammarCommand | null
  path: string[]
  /** First positional token that failed to extend the match, if any. */
  unmatched: string | null
}

function resolvePath(
  tokens: string[],
  grammar: CliGrammar
): ResolvedPath | 'unjudgeable' {
  const path: string[] = []
  let node: GrammarCommand | null = null
  let i = 0
  for (; i < tokens.length; i++) {
    const t = tokens[i]!
    if (looksLikeFlag(t) || isRedirection(t) || t === '--') break
    // A dynamic token in command position ($CMD, backticks) can resolve to
    // anything at run time — static judgment is impossible.
    if (isDynamicValue(t)) return 'unjudgeable'
    const candidate = [...path, t].join(' ')
    const next = grammar.commands[candidate]
    if (!next) {
      // Token does not extend the command path: positional arg if the
      // current node can be called itself (a leaf, or a parent with its own
      // action — commander hands the token to that action), unrecognized
      // subcommand if it's a pure routing group.
      // Quote debris / non-word tokens are extraction noise, not attempts.
      const offends = node === null || needsSubcommand(node)
      if (offends && !isCleanWordToken(t)) return 'unjudgeable'
      return { node, path, unmatched: offends ? t : null }
    }
    node = next
    path.push(t)
    if (!node.hasSubcommands) {
      return { node, path, unmatched: null }
    }
  }
  return { node, path, unmatched: null }
}

function flagLookup(
  token: string,
  node: GrammarCommand | null,
  isRoot: boolean
): GrammarFlag | null {
  const name = token.split('=')[0]!
  const pools: Record<string, GrammarFlag>[] = [
    node?.flags ?? {},
    GLOBAL_FLAGS,
    ...(isRoot ? [ROOT_FLAGS] : []),
  ]
  for (const pool of pools) {
    if (pool[name]) return pool[name]!
    for (const f of Object.values(pool)) {
      if (f.short === name) return f
    }
  }
  return null
}

/**
 * Validate one `lumo …` segment against the grammar. First violation wins
 * (matching how commander itself fails fast).
 */
export function validateSegment(
  segment: string,
  grammar: CliGrammar
): AstVerdict {
  // Heredocs (`--description "$(cat <<'EOF' …)"`) are beyond static
  // tokenization — their bodies contain real quotes that desync any quote
  // tracking. Declining to judge beats fake hallucinations.
  if (segment.includes('<<')) {
    return {
      kind: 'valid',
      commandPath: '',
      offending: null,
      detail: 'unjudgeable: heredoc in segment',
    }
  }

  const tokens = tokenize(segment)
  if (tokens[0] === 'lumo') tokens.shift()

  // Commander's built-in `help [command]` subcommand is always available.
  if (tokens[0] === 'help') {
    return { kind: 'valid', commandPath: 'help', offending: null, detail: null }
  }

  // Bare `lumo` (optionally with root flags) is a valid help invocation.
  const resolved = resolvePath(tokens, grammar)
  if (resolved === 'unjudgeable') {
    return {
      kind: 'valid',
      commandPath: '',
      offending: null,
      detail: 'unjudgeable: dynamic or non-word token in command position',
    }
  }
  const { node, path, unmatched } = resolved
  const commandPath = path.join(' ')

  if (unmatched !== null) {
    return {
      kind: 'unknown-command',
      commandPath,
      offending: unmatched,
      detail: `"${unmatched}" is not a subcommand of "${commandPath || 'lumo'}"`,
    }
  }
  if (needsSubcommand(node)) {
    const hasHelp = tokens.some(t => t === '--help' || t === '-h')
    if (!hasHelp) {
      return {
        kind: 'unknown-command',
        commandPath,
        offending: null,
        detail: `"${commandPath}" requires a subcommand`,
      }
    }
  }

  // Flag walk over the remainder of the segment.
  let i = path.length
  let positionalOnly = false
  for (; i < tokens.length; i++) {
    const t = tokens[i]!
    if (positionalOnly) continue
    if (t === '--') {
      positionalOnly = true
      continue
    }
    if (isRedirection(t)) {
      // `> file` / `2>&1`: skip the redirection target too.
      if (t === '>' || t === '<' || t === '>>' || t === '2>') i++
      continue
    }
    if (!looksLikeFlag(t)) continue // positional / flag value already consumed
    // Flag-shaped but dirty tokens (shell metacharacters, prose debris from
    // truncated quotes) are not judged — skipping beats a fake hallucination.
    if (!isCleanFlagToken(t)) continue

    const flag = flagLookup(t, node, path.length === 0)
    if (!flag) {
      const name = t.split('=')[0]!
      return {
        kind: 'unknown-flag',
        commandPath,
        offending: name,
        detail: `"${name}" is not a flag of "${['lumo', ...path].join(' ')}"`,
      }
    }

    // Resolve the flag's value (--flag=v or the next token) for enum checks.
    let value: string | null = null
    if (t.includes('=')) {
      value = t.slice(t.indexOf('=') + 1)
    } else if (
      flag.value !== 'none' &&
      i + 1 < tokens.length &&
      !looksLikeFlag(tokens[i + 1]!) &&
      !isRedirection(tokens[i + 1]!)
    ) {
      value = tokens[i + 1]!
      i++ // consume the value token
    }
    if (flag.enum && value !== null && !isDynamicValue(value)) {
      const legal = flag.enumCaseInsensitive
        ? flag.enum.some(e => foldEnumToken(e) === foldEnumToken(value))
        : flag.enum.includes(value)
      if (!legal) {
        return {
          kind: 'illegal-enum',
          commandPath,
          offending: value,
          detail: `"${value}" is not a legal value of ${flag.long} (${flag.enum.join(' | ')})`,
        }
      }
    }
  }

  return { kind: 'valid', commandPath, offending: null, detail: null }
}
