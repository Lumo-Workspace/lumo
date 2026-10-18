/**
 * LUM-392: pure parsing helpers for mining lumo CLI invocations out of
 * Bash-tool hook events. No I/O here — everything is unit-testable.
 *
 * A single Bash tool call may contain several shell statements; we extract
 * every `lumo …` invocation segment, resolve it against the known command
 * tree (longest token-prefix match), and classify the tool_response output
 * with error heuristics. Unknown command paths are kept verbatim — an agent
 * invoking a command that doesn't exist is itself a friction signal.
 */

/** Every invocation path the CLI ships today (cli/src/commands/*). */
export const KNOWN_COMMAND_PATHS: string[] = [
  'auth login',
  'auth logout',
  'crossing explain',
  'doc create',
  'doc delete',
  'doc diff',
  'doc import',
  'doc list',
  'doc move',
  'doc show',
  'doc sync',
  'doc update',
  'hook',
  'status',
  'project list',
  'milestone add',
  'milestone archive',
  'milestone create',
  'milestone delete',
  'milestone list',
  'milestone move',
  'milestone remove',
  'milestone reorder',
  'milestone show',
  'milestone summary',
  'milestone unarchive',
  'milestone update',
  'session attach',
  'session status',
  'setup',
  'sprint add',
  'sprint close',
  'sprint create',
  'sprint delete',
  'sprint list',
  'sprint remove',
  'sprint show',
  'sprint start',
  'sprint summary',
  'sprint update',
  'task artifact add',
  'task artifact list',
  'task artifact rm',
  'task artifact show',
  'task artifact update',
  'task comment',
  'task deps add',
  'task deps confirm',
  'task deps dismiss',
  'task deps rm',
  'task figma add',
  'task figma context',
  'task figma list',
  'task figma refresh',
  'task figma rm',
  'task list',
  'task pr show',
  'task slack show',
  'task status',
  'task show',
  'task create',
  'task update',
  'task web show',
  'update',
  'whoami',
  'worktree add',
  'worktree list',
  'worktree rm',
]

// Longest paths first so `task comments list` wins over `task comment`.
const PATHS_BY_LENGTH = [...KNOWN_COMMAND_PATHS]
  .map(p => p.split(' '))
  .sort((a, b) => b.length - a.length)

export interface LumoInvocation {
  /** Resolved command path, e.g. "task deps add", or "unknown:<tokens>". */
  commandPath: string
  /** True when commandPath matched the known command tree. */
  known: boolean
  /** Flag tokens present in the segment (deduped, values stripped). */
  flags: string[]
  /** The raw `lumo …` segment as found in the Bash command. */
  raw: string
}

/**
 * Tokenize a shell segment, honoring single/double quotes well enough for
 * flag and subcommand extraction (no expansion, no escapes inside quotes).
 */
export function tokenize(segment: string): string[] {
  const tokens: string[] = []
  const re = /'([^']*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(segment)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return tokens
}

/**
 * Extract every `lumo …` invocation segment from a Bash command string.
 * Splits on statement separators (&&, ||, |, ;, newline, $(, `) and keeps
 * only segments whose first token is exactly `lumo` (so `/path/lumo_x` or
 * `echo lumo` don't count, but `cd x && lumo task list` does).
 */
/**
 * Quote-aware statement splitting: separators (&&, ||, ;, |, newline, $( )
 * inside single/double quotes do NOT split. Without this, a quoted multi-line
 * comment body breaks open mid-quote and leaks its prose as fake commands and
 * fake `--flag` tokens (LUM-413). Backticks deliberately don't split: docs
 * quote `lumo …` in backticks as references, not executions.
 */
function splitStatements(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote) {
      cur += ch
      if (ch === quote && command[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }
    const two = command.slice(i, i + 2)
    if (two === '&&' || two === '||' || two === '$(') {
      out.push(cur)
      cur = ''
      i++
      continue
    }
    if (ch === ';' || ch === '|' || ch === '\n') {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

export function extractLumoSegments(command: string): string[] {
  const segments = splitStatements(command)
    .map(s => s.trim())
    .filter(Boolean)
  const out: string[] = []
  // Leading `FOO=bar ` / `FOO="b a r" ` env assignment (quoted values kept).
  const envAssignRe =
    /^[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"(?:[^"\\]|\\.)*"|\S*)\s+/
  for (const seg of segments) {
    // Doc-content artifacts: heredoc/echo/sed lines that mention lumo commands
    // (line continuations, sed addresses over SKILL.md, markdown bullets).
    if (seg.endsWith('\\') || seg.includes('SKILL.md')) continue
    // Strip leading env assignments (FOO=bar lumo …); keep the original
    // segment text after that — quoting must survive, otherwise free-text
    // positionals (comment bodies, titles) leak fake `--flag` tokens into
    // downstream flag extraction and AST validation (LUM-413).
    let rest = seg.trimStart()
    while (envAssignRe.test(rest)) rest = rest.replace(envAssignRe, '')
    if (rest === 'lumo' || /^lumo\s/.test(rest)) {
      out.push(rest)
    }
  }
  return out
}

/**
 * First positional (non-flag) argument after the command path — usually the
 * task/doc identifier. Used to scope retry chains to the same target.
 */
export function firstPositionalArg(inv: LumoInvocation): string | null {
  if (!inv.known) return null
  const tokens = tokenize(inv.raw).slice(1 + inv.commandPath.split(' ').length)
  for (const t of tokens) {
    if (t.startsWith('-') || t.startsWith('>') || t.startsWith('<')) break
    return t
  }
  return null
}

/** Resolve a `lumo …` segment into a LumoInvocation. */
export function parseInvocation(segment: string): LumoInvocation {
  const tokens = tokenize(segment).slice(1) // drop leading `lumo`
  // Stop subcommand-path matching at the first flag or shell redirection.
  const pathTokens: string[] = []
  for (const t of tokens) {
    if (
      t.startsWith('-') ||
      t.startsWith('>') ||
      t.startsWith('<') ||
      t === '2>'
    )
      break
    pathTokens.push(t)
  }
  for (const candidate of PATHS_BY_LENGTH) {
    if (
      candidate.length <= pathTokens.length &&
      candidate.every((tok, i) => pathTokens[i] === tok)
    ) {
      return {
        commandPath: candidate.join(' '),
        known: true,
        flags: extractFlags(tokens),
        raw: segment,
      }
    }
  }
  const unknownHead = pathTokens.slice(0, 3).join(' ') || '(bare)'
  return {
    commandPath: `unknown:${unknownHead}`,
    known: false,
    flags: extractFlags(tokens),
    raw: segment,
  }
}

function extractFlags(tokens: string[]): string[] {
  const flags = new Set<string>()
  for (const t of tokens) {
    if (/^--?[A-Za-z]/.test(t)) flags.add(t.split('=')[0] ?? t)
  }
  return [...flags]
}

export interface OutputClassification {
  /** Did this Bash call's output show a CLI failure signal? */
  errored: boolean
  /** Which heuristic fired (first match). */
  errorKind:
    | 'cli-error' // `Error: …` line (cli/src error path)
    | 'usage-error' // commander usage/unknown command|option
    | 'not-found' // command not found / ENOENT (lumo not installed)
    | 'interrupted' // user/agent interrupted the tool call
    | null
  /** First matching line, for the findings report. */
  evidence: string | null
}

/**
 * Classify a Bash tool_response for lumo failure signals. When the Bash
 * call contained more than one lumo invocation the result is attributed to
 * the call as a whole (callers mark multi-invocation events as ambiguous).
 */
export function classifyOutput(opts: {
  stdout: string
  stderr: string
  interrupted: boolean
}): OutputClassification {
  if (opts.interrupted) {
    return { errored: true, errorKind: 'interrupted', evidence: null }
  }
  const combined = `${opts.stderr}\n${opts.stdout}`
  const lines = combined.split('\n')
  const firstMatch = (re: RegExp) => lines.find(l => re.test(l)) ?? null

  const usage = firstMatch(
    /error: (unknown command|unknown option|missing required|too many arguments)/i
  )
  if (usage)
    return { errored: true, errorKind: 'usage-error', evidence: usage.trim() }

  const cliErr = firstMatch(/^\s*Error: /)
  if (cliErr)
    return { errored: true, errorKind: 'cli-error', evidence: cliErr.trim() }

  const notFound = firstMatch(/lumo: command not found|ENOENT.*lumo/)
  if (notFound)
    return { errored: true, errorKind: 'not-found', evidence: notFound.trim() }

  return { errored: false, errorKind: null, evidence: null }
}
