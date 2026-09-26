/**
 * Check-command recognition for the delivery checks panel (LUM-614, reshaped in
 * LUM-839). Decides which of the agent's own shell commands ran a check (a type
 * check, build or test run), so the panel can list them under "Agent
 * self-reported" next to the independent CI checks.
 *
 * LUM-839 dropped the fixed typecheck/build/test gate taxonomy: CI checks are
 * shown by their own names, and the agent's checks by the invocation it ran.
 * This module only answers "which parts of this command line invoke a check?" —
 * it never labels one, and it carries no status (status comes from the HookEvent
 * row that recorded the run).
 *
 * A check counts only where a command actually runs (LUM-839 TC2): a check word
 * inside a heredoc body, a quoted argument, a commit message or a file path
 * (`cat scripts/jest-t.ts`, `--evidence-file …/jest.log`) is not a check run.
 */

/** Tools that are a check run when invoked directly (or via npx / exec). */
const CHECK_TOOLS: ReadonlySet<string> = new Set(['tsc', 'jest', 'vitest'])

/** Package-manager scripts that are a check run (`npm test`, `pnpm run build`, `npm run test:unit`). */
const CHECK_SCRIPT = /^(test|t|build|typecheck|type-check|tsc)(:[\w:-]+)?$/

const PACKAGE_MANAGERS: ReadonlySet<string> = new Set([
  'npm',
  'pnpm',
  'yarn',
  'bun',
])

/** Wrappers that run the next word as the command (`npx jest`, `bunx vitest`). */
const EXEC_WRAPPERS: ReadonlySet<string> = new Set(['npx', 'pnpx', 'bunx'])

/** Script runners: a check when the script they run is named after a check tool (`tsx scripts/jest-t.ts`). */
const SCRIPT_RUNNERS: ReadonlySet<string> = new Set(['node', 'tsx', 'ts-node'])

/** Words that can precede the real command in a segment (`do npx jest`, `time jest`). */
const PREFIX_WORDS: ReadonlySet<string> = new Set([
  'do',
  'then',
  'else',
  'elif',
  'time',
  'exec',
  'command',
  'env',
  'nohup',
  '!',
  '{',
])

/** Shell keywords stripped from the front of a shown invocation (`do npx jest` → `npx jest`). */
const LEADING_KEYWORDS = /^(?:(?:do|then|else|elif|!|\{)\s+)+/

const HEREDOC_START = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/g

/**
 * Drop heredoc bodies (and their closing delimiter lines). The line that opens
 * the heredoc is kept — it is a real command — but the body is data fed to it.
 */
function stripHeredocBodies(command: string): string {
  const out: string[] = []
  const pending: string[] = []
  for (const line of command.split('\n')) {
    if (pending.length > 0) {
      if (line.trim() === pending[0]) pending.shift()
      continue
    }
    out.push(line)
    for (const m of line.matchAll(HEREDOC_START)) {
      if (line[m.index - 1] === '<') continue // `<<<` here-string, not a heredoc
      pending.push(m[2]!)
    }
  }
  return out.join('\n')
}

interface Segment {
  /** The segment as written (quotes kept) — what the panel shows. */
  text: string
  /** The segment with quoted text blanked out — what gets tokenized. */
  bare: string
}

/**
 * Split a command line into simple commands on `&&`, `||`, `;`, `|`, `&`,
 * newlines, `(`, `)` and backticks — only outside quotes. A `&` inside a
 * redirection (`2>&1`, `&>`) is not a separator.
 */
function splitSegments(command: string): Segment[] {
  const segments: Segment[] = []
  let text = ''
  let bare = ''
  let quote: '"' | "'" | null = null
  const flush = () => {
    if (text.trim()) segments.push({ text: text.trim(), bare })
    text = ''
    bare = ''
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote) {
      text += c
      if (c === '\\' && quote === '"' && i + 1 < command.length) {
        text += command[++i]
      } else if (c === quote) {
        quote = null
      }
      bare += ' '
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      text += c
      bare += ' '
      continue
    }
    if (c === '\\' && i + 1 < command.length) {
      text += c + command[i + 1]
      bare += '  '
      i++
      continue
    }
    const isAmp =
      c === '&' &&
      !'<>'.includes(command[i - 1] ?? '') &&
      command[i + 1] !== '>'
    if (c === ';' || c === '|' || c === '\n' || c === '(' || c === ')') {
      flush()
    } else if (c === '`') {
      flush()
    } else if (isAmp) {
      if (command[i + 1] === '&') i++
      flush()
    } else {
      text += c
      bare += c
    }
  }
  flush()
  return segments
}

function basename(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1)
}

/** True when a script file name names a check tool (`jest-t.ts`, `run-vitest.mjs`). */
function namesCheckTool(path: string): boolean {
  return /(^|[^a-z])(jest|vitest|tsc)([^a-z]|$)/i.test(basename(path))
}

/** Does this list of words (a simple command) invoke a check? */
function invokesCheck(words: readonly string[]): boolean {
  let i = 0
  // Skip env assignments (`CI=1 jest`) and shell prefix words (`do jest`).
  while (
    i < words.length &&
    (/^[A-Za-z_]\w*=/.test(words[i]!) || PREFIX_WORDS.has(words[i]!))
  ) {
    i++
  }
  const cmd = words[i] === undefined ? undefined : basename(words[i]!)
  if (cmd === undefined) return false
  const rest = words.slice(i + 1)
  const args = rest.filter(w => !w.startsWith('-'))

  if (CHECK_TOOLS.has(cmd)) return true
  if (cmd === 'next') return args[0] === 'build'
  if (EXEC_WRAPPERS.has(cmd)) {
    const at = rest.findIndex(w => !w.startsWith('-'))
    return at >= 0 && invokesCheck(rest.slice(at))
  }
  if (PACKAGE_MANAGERS.has(cmd)) {
    const [first, second] = args
    if (first === undefined) return false
    if (first === 'run' || first === 'run-script') {
      return second !== undefined && CHECK_SCRIPT.test(second)
    }
    if (first === 'exec' || first === 'dlx' || first === 'x') {
      const at = rest.indexOf(first)
      return invokesCheck(rest.slice(at + 1).filter(w => !w.startsWith('-')))
    }
    return CHECK_SCRIPT.test(first) || CHECK_TOOLS.has(first)
  }
  if (SCRIPT_RUNNERS.has(cmd)) {
    return args[0] !== undefined && namesCheckTool(args[0])
  }
  return false
}

/**
 * The parts of an executed shell command line that invoke a check, as written.
 * Empty when the command runs no check. A chained line (`npx jest …; npx tsc
 * --noEmit`) yields each check it runs; the rest of the line (file writes,
 * `git`, `echo`, …) is left out.
 */
export function checkInvocations(command: string): string[] {
  return splitSegments(stripHeredocBodies(command))
    .filter(seg => invokesCheck(seg.bare.split(/\s+/).filter(Boolean)))
    .map(seg => seg.text.replace(LEADING_KEYWORDS, ''))
}

/** True when an executed shell command runs at least one check. */
export function isCheckCommand(command: string): boolean {
  return checkInvocations(command).length > 0
}
