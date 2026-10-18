/**
 * LUM-1232 batch E — one shape for every error the CLI prints
 * (docs/cli-output-conventions.md X-1–X-4, J-4):
 *
 *   Error: <what failed>
 *   Usage: lumo <command> …        (usage errors only)
 *   Hint: <what to run next>
 *
 * all on stderr. Commands keep printing their own `Error: …` line; this
 * module normalises it on the way out (one `Error:` prefix, a trailing
 * `Usage: …` / `Try …` / remediation sentence moved to its own line) and, at
 * exit, adds the `Hint:` a usage error or a not-found error is missing.
 *
 * With `--json` the same lines are collected instead and, when the command
 * fails, printed as ONE JSON object on stderr:
 *   {"error":{"code":"NOT_FOUND","message":"…","hint":"…","exitCode":1}}
 * Exit 4 / 5 envelopes are stdout and untouched; a successful run's stderr is
 * passed through unchanged.
 */
import * as fs from 'fs'

export type ErrorCode =
  | 'USAGE'
  | 'COMMAND_REMOVED'
  | 'NOT_FOUND'
  | 'AUTH'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'SERVER'
  | 'NETWORK'
  | 'UNKNOWN'

export interface ErrorJson {
  error: {
    code: ErrorCode
    message: string
    hint?: string
    /** Any other stderr lines (warnings, details), in order. */
    details?: string[]
    exitCode: number
  }
}

const ERROR_RE = /^error: /
const USAGE_SUFFIX_RE = /^(Error: .*?)\.?\s+Usage: (lumo .+)$/
const USAGE_ONLY_RE = /^Error: usage: (lumo .+)$/
const TRY_SUFFIX_RE = /^(Error: .*?)\.\s+Try (`lumo [^`]+`)\.?$/
// "Error: sprint #9 not found in this workspace. If … pass … " → the second
// sentence is remediation.
const NOT_FOUND_TAIL_RE = /^(Error: .*\bnot found\b[^.]*)\.\s+(\S.*)$/
const COMMANDER_HELP_LINE =
  '(run the command with --help to list its valid flags and arguments)'

/**
 * Normalise one stderr line into one or more lines of the X-1 shape.
 * Pure; the protected auth strings and anything without an error prefix pass
 * through unchanged.
 */
export function normalizeErrorLine(line: string): string[] {
  if (line === COMMANDER_HELP_LINE) return []
  const l = line.replace(ERROR_RE, 'Error: ')
  let m = USAGE_ONLY_RE.exec(l)
  if (m) return ['Error: missing or invalid arguments', `Usage: ${m[1]}`]
  m = USAGE_SUFFIX_RE.exec(l)
  if (m) return [m[1]!, `Usage: ${m[2]}`]
  m = TRY_SUFFIX_RE.exec(l)
  if (m) return [m[1]!, `Hint: run ${m[2]}.`]
  m = NOT_FOUND_TAIL_RE.exec(l)
  if (m && !/`lumo auth login`/.test(l)) return [m[1]!, `Hint: ${m[2]}`]
  return [l]
}

const NOT_FOUND_HINTS: Array<[RegExp, string]> = [
  [
    /\btask\b/i,
    'list tasks with `lumo task list`, or search with `lumo task search <text>`.',
  ],
  [/\bmilestone\b/i, 'list milestones with `lumo milestone list`.'],
  [/\bsprint\b/i, 'list sprints with `lumo sprint list`.'],
  [/\bPR #/i, "list the task's pull requests with `lumo task show <LUM-N>`."],
  [/\bdoc(ument)?\b/i, 'list docs with `lumo doc list`.'],
  [/\bproject\b/i, 'list projects with `lumo project list`.'],
  [/\bmemor(y|ies)\b/i, 'list memories with `lumo memory list`.'],
  [
    /\btest case\b|\/TC\d+/i,
    'list test cases with `lumo task testcase list <LUM-N>`.',
  ],
  [/\bartifact\b/i, 'list artifacts with `lumo task artifact list <LUM-N>`.'],
  [/\bcrossing\b/i, 'list crossings with `lumo crossing list <LUM-N> --all`.'],
  [/\bmember\b/i, 'list members with `lumo member list`.'],
]

/** The Hint a not-found error gets when it has none (null: not a not-found). */
export function notFoundHint(errorLine: string): string | null {
  if (!/\bnot found\b|\bno \w+ matches\b/i.test(errorLine)) return null
  for (const [re, hint] of NOT_FOUND_HINTS) if (re.test(errorLine)) return hint
  return null
}

/** The machine code of a failure, from its exit code and message. */
export function classifyError(exitCode: number, message: string): ErrorCode {
  // LUM-1233 (RN-3): a tombstoned command — a usage error with its own code.
  if (exitCode === 2 && /^lumo .+ was removed\. Use: lumo /.test(message))
    return 'COMMAND_REMOVED'
  if (exitCode === 2) return 'USAGE'
  if (/API key invalid or revoked|not logged in|HTTP 401/i.test(message))
    return 'AUTH'
  if (/\bnot found\b|HTTP 404|no \w+ matches/i.test(message)) return 'NOT_FOUND'
  if (/HTTP 403|forbidden|only workspace owners/i.test(message))
    return 'FORBIDDEN'
  if (/HTTP 409|conflict/i.test(message)) return 'CONFLICT'
  if (/HTTP 5\d\d/.test(message)) return 'SERVER'
  if (
    /could not reach|ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(message)
  )
    return 'NETWORK'
  return 'UNKNOWN'
}

/** Build the J-4 JSON error object from the collected stderr lines. */
export function buildErrorJson(lines: string[], exitCode: number): ErrorJson {
  let message = ''
  let hint: string | undefined
  const details: string[] = []
  for (const raw of lines) {
    const l = raw.trimEnd()
    if (!l) continue
    if (!message && l.startsWith('Error: ')) message = l.slice(7)
    else if (!hint && l.startsWith('Hint: ')) hint = l.slice(6)
    else details.push(l)
  }
  if (!message) message = details.shift() ?? 'command failed'
  return {
    error: {
      code: classifyError(exitCode, message),
      message,
      ...(hint ? { hint } : {}),
      ...(details.length > 0 ? { details } : {}),
      exitCode,
    },
  }
}

// ── the process-level filter ───────────────────────────────────────────────

interface FilterState {
  json: boolean
  /** JSON mode: every stderr line, in order. Text mode: unused. */
  buffered: string[]
  partial: string
  sawError: boolean
  sawHint: boolean
  sawUsage: boolean
  /** True when the caller supplied its own sink (tests): never write fd 2. */
  customSink: boolean
  lastError: string | null
  finalized: boolean
  write: (s: string) => void
}

let state: FilterState | null = null
let restoreStderr: (() => void) | null = null
let exitListener: ((code: number) => void) | null = null

/**
 * Route process.stderr through the normaliser (text mode) or a buffer
 * (`--json`). Idempotent. `write` is the raw sink (tests pass their own).
 */
export function installErrorOutput(
  opts: { json: boolean; write?: (s: string) => void } = { json: false }
): void {
  if (state) return
  const originalWrite = process.stderr.write
  const original = originalWrite.bind(process.stderr)
  const write =
    opts.write ??
    ((s: string) => {
      original(s)
    })
  state = {
    json: opts.json,
    buffered: [],
    partial: '',
    sawError: false,
    sawHint: false,
    sawUsage: false,
    customSink: opts.write !== undefined,
    lastError: null,
    finalized: false,
    write,
  }
  const st = state
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text =
      typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk as Uint8Array).toString()
    feed(st, text)
    const cb = rest.find(r => typeof r === 'function') as
      | (() => void)
      | undefined
    cb?.()
    return true
  }) as typeof process.stderr.write
  restoreStderr = () => {
    process.stderr.write = originalWrite
  }
  // A run that ends without exitWith (success) still flushes what it held.
  exitListener = (code: number) => finalizeErrorOutput(code ?? 0)
  process.on('exit', exitListener)
}

function feed(st: FilterState, text: string): void {
  const all = st.partial + text
  const parts = all.split('\n')
  st.partial = parts.pop() ?? ''
  for (const line of parts) emitLine(st, line)
  // Text mode never holds back output that cannot be an error line (progress
  // text written without a newline shows up immediately).
  if (
    !st.json &&
    st.partial &&
    !/^(?:e|er|err|erro|error|error:.*)$/i.test(st.partial)
  ) {
    st.write(st.partial)
    st.partial = ''
  }
}

function emitLine(st: FilterState, line: string): void {
  for (const l of normalizeErrorLine(line)) {
    if (l.startsWith('Error: ')) {
      st.sawError = true
      st.lastError = l
    }
    if (l.startsWith('Hint: ')) st.sawHint = true
    if (l.startsWith('Usage: ')) st.sawUsage = true
    if (st.json) st.buffered.push(l)
    else st.write(l + '\n')
  }
}

/**
 * Finish the error output for `exitCode`: add the missing Hint (usage →
 * `--help`, not found → the listing command) and, under `--json`, print the
 * single JSON object for a failure or flush the held lines for a success.
 * `usage` is the failing command's usage line (`lumo pr show [options] <number>`).
 */
export function finalizeErrorOutput(
  exitCode: number,
  ctx: { usage?: string | null; helpCommand?: string | null } = {}
): void {
  const st = state
  if (!st || st.finalized) return
  if (st.partial) {
    emitLine(st, st.partial)
    st.partial = ''
  }
  const failed = exitCode === 1 || exitCode === 2
  const extra: string[] = []
  if (failed && st.sawError) {
    if (exitCode === 2 && ctx.usage && !st.sawUsage)
      extra.push(`Usage: ${ctx.usage}`)
    if (!st.sawHint) {
      const hint =
        exitCode === 2
          ? ctx.helpCommand
            ? `see \`${ctx.helpCommand} --help\` for every flag and argument.`
            : null
          : notFoundHint(st.lastError ?? '')
      if (hint) extra.push(`Hint: ${hint}`)
    }
  }
  st.finalized = true
  if (!st.json) {
    for (const l of extra) st.write(l + '\n')
    return
  }
  if (failed) {
    // Even a failure that printed no `Error:` line is one JSON object.
    const out = JSON.stringify(
      buildErrorJson([...st.buffered, ...extra], exitCode)
    )
    syncWrite(st, out + '\n')
  } else if (st.buffered.length > 0) {
    syncWrite(st, st.buffered.join('\n') + '\n')
  }
}

function syncWrite(st: FilterState, s: string): void {
  if (st.customSink) {
    st.write(s)
    return
  }
  // At process exit an async pipe write can be lost; fd 2 written directly is not.
  try {
    fs.writeSync(2, s)
  } catch {
    st.write(s)
  }
}

/** Test hook: uninstall the filter and restore process.stderr.write. */
export function resetErrorOutputForTests(): void {
  restoreStderr?.()
  restoreStderr = null
  if (exitListener) process.off('exit', exitListener)
  exitListener = null
  state = null
}
