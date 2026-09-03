/**
 * referentKind (LUM-602): what a criterion anchors — the only dimension that
 * determines independence. Dependency-light (no @prisma/client) so both the
 * Next.js server and the CLI can import it; the Prisma `ReferentKind` enum
 * mirrors REFERENT_KIND_DECLARABLE exactly.
 */
export const REFERENT_KIND_DECLARABLE = [
  'EXTERNAL_FACT',
  'AGENT_CONSTRUCTED_STATE',
  'PENDING_OUTCOME',
] as const
export type DeclarableReferentKind = (typeof REFERENT_KIND_DECLARABLE)[number]

/**
 * LUM-733: the kinds a TASK criterion may still carry. PENDING_OUTCOME is no
 * longer accepted on task criteria (it had no check and no reader); it remains
 * declarable on milestone exit criteria only.
 */
export const TASK_REFERENT_KIND_DECLARABLE = [
  'EXTERNAL_FACT',
  'AGENT_CONSTRUCTED_STATE',
] as const
export type TaskReferentKind = (typeof TASK_REFERENT_KIND_DECLARABLE)[number]

/** Falsifier-derived buckets that an agent can never declare. */
export type EffectiveReferentKind =
  | DeclarableReferentKind
  | 'UNVERIFIED_ASSERTION' // declared EXTERNAL_FACT, not earned by the check
  | 'UNCLASSIFIED' // legacy row predating the field (null)

export type CheckpointerGrounding =
  | 'EXTERNAL'
  | 'AGENT_HARNESS'
  | 'ASSERTION_ONLY'
  | 'NONE'

/** Tools whose output the agent cannot author — external facts. */
const EXTERNAL_TOOLS = [
  'git',
  'gh',
  'curl',
  'wget',
  'http',
  'https',
  'psql',
  'dig',
  'nc',
]
/** Agent's own test/type/build harness — green here is self-confirming. */
const HARNESS_TOOLS = [
  'jest',
  'vitest',
  'mocha',
  'pytest',
  'tsc',
  'node',
  'ts-node',
  'tsx',
]

/**
 * `prisma migrate status` is EXTERNAL (queries DB/migration history); a bare
 * `prisma generate` is harness. Matched as a two-word phrase before the
 * single-word scan.
 */
const EXTERNAL_PHRASES = ['prisma migrate status']

function wordMatches(word: string, tools: string[]): boolean {
  // exact tool, or a tool-prefixed filename like jest-t.ts / vitest.config
  return tools.some(
    t => word === t || word.startsWith(`${t}-`) || word.startsWith(`${t}.`)
  )
}

/**
 * No-op external invocations (LUM-605): forms whose exit code and output are
 * constant w.r.t. external state (`git --version`, `gh --help`, …). An external
 * tool invoked this way establishes no external fact, so it must never ground
 * EXTERNAL — this is half of the C-hole fix (the other half is the consumption
 * requirement below). Kept deliberately small/conservative: a smaller set means
 * fewer real external checks get mistaken for no-ops (we'd rather under-flag a
 * decoy than false-downgrade a genuine check, which enforcement now penalizes).
 */
const NOOP_FLAG_TOKENS = new Set(['--version', '--help'])
/** No-op SUBCOMMAND forms — only when they are the first word after the tool
 *  (`git version`, `gh help`). Not matched as a bare flag-anywhere, so we don't
 *  trip on an unrelated positional like a psql `-h <host>` (host, not help). */
const NOOP_SUBCOMMANDS = new Set(['version', 'help'])

/**
 * Given a raw command word (possibly `npx jest`, `npm run build`, etc.),
 * normalize to the effective tool name. Returns null for pure wrapper tokens
 * (npx, sudo, command) that should cause us to advance to the next word.
 */
function normalizeCommandWord(word: string): string {
  // strip a leading path: scripts/jest-t.ts → jest-t.ts (keep basename)
  const slash = word.lastIndexOf('/')
  return slash >= 0 ? word.slice(slash + 1) : word
}

/**
 * Extract command-position words from a shell script string.
 *
 * Algorithm:
 * 1. Strip `#` comments (everything from # to end of line).
 * 2. Extract `$(...)` and backtick substitutions — they are command
 *    lists; recurse into them and add their command-position words.
 * 3. For `bash -c '...'` / `sh -c '...'` tokens, extract the quoted
 *    payload and recurse into it as a command list.
 * 4. Split the remaining text on command separators (|, &&, ||, ;, \n)
 *    to get individual command segments.
 * 5. From each segment, take the first meaningful word as the command.
 *    Skip wrapper words (npx, sudo, command) and "npm run" pairs.
 */
function collectCommandWords(script: string): string[] {
  const result: string[] = []

  // Step 1: strip # comments (not inside quotes — simple heuristic: strip
  // from # that is preceded by whitespace or start-of-line to end of line)
  const noComments = script.replace(/(^|\s)#[^\n]*/gm, ' ')

  // Step 2: recurse into $(...) substitutions
  // We use a simple balanced-paren extractor.
  let remaining = noComments
  remaining = remaining.replace(/\$\(([^)]*)\)/g, (_match, inner) => {
    result.push(...collectCommandWords(inner))
    return ' '
  })

  // Recurse into backtick substitutions
  remaining = remaining.replace(/`([^`]*)`/g, (_match, inner) => {
    result.push(...collectCommandWords(inner))
    return ' '
  })

  // Step 3: handle bash -c / sh -c with a single-quoted payload.
  // Pattern: (bash|sh) ... -c '...' or (bash|sh) ... -c "..."
  // We do this BEFORE splitting on separators so the payload content
  // doesn't pollute the segment split.
  remaining = remaining.replace(
    /\b(?:bash|sh)\b[^'"]*-c\s+'([^']*)'/g,
    (_match, payload) => {
      result.push(...collectCommandWords(payload))
      return ' '
    }
  )
  remaining = remaining.replace(
    /\b(?:bash|sh)\b[^'"]*-c\s+"([^"]*)"/g,
    (_match, payload) => {
      result.push(...collectCommandWords(payload))
      return ' '
    }
  )

  // Step 4: split on command separators to get segments.
  // Split on |, &&, ||, ;, newlines. Note: || must be checked before |.
  const segments = remaining.split(/\|\||&&|[|;\n]/)

  // Step 5: from each segment extract the command word.
  for (const seg of segments) {
    // Strip leading/trailing whitespace and any residual shell chars
    // (quotes, $, brackets not already consumed).
    const cleaned = seg
      .replace(/['"]/g, ' ') // remove remaining quotes (string args)
      .replace(/\[|\]/g, ' ') // remove [ ] test brackets
      .replace(/\$\{?[^}]*}?/g, ' ') // remove remaining $VAR references
      .trim()
    if (!cleaned) continue

    const tokens = cleaned.split(/\s+/).filter(Boolean)
    // Walk tokens to find the effective command, skipping wrappers.
    let i = 0
    while (i < tokens.length) {
      const tok = tokens[i]!
      const lower = tok.toLowerCase()
      if (lower === 'npx' || lower === 'sudo' || lower === 'command') {
        i++
        continue
      }
      if (lower === 'npm' && tokens[i + 1]?.toLowerCase() === 'run') {
        // "npm run <script>" — script name is the command
        i += 2
        continue
      }
      // This is the effective command
      const word = normalizeCommandWord(lower)
      if (word) result.push(word)
      break
    }
  }

  return result
}

function isExternalTool(word: string): boolean {
  return wordMatches(word, EXTERNAL_TOOLS)
}

/**
 * Parse one shell command segment (already split off sequencing/pipe operators)
 * into its effective tool + whether it is a no-op invocation. Mirrors the
 * wrapper-skipping of {@link collectCommandWords} (npx / sudo / command / npm
 * run), then reads the post-tool tokens to flag no-op forms (LUM-605).
 */
function parseInvocation(
  segment: string
): { tool: string; isNoop: boolean } | null {
  const cleaned = segment
    .replace(/['"]/g, ' ')
    .replace(/\[|\]/g, ' ')
    .replace(/\$\{?[^}]*}?/g, ' ')
    .trim()
  if (!cleaned) return null
  const tokens = cleaned.split(/\s+/).filter(Boolean)
  let i = 0
  while (i < tokens.length) {
    const lower = tokens[i]!.toLowerCase()
    if (lower === 'npx' || lower === 'sudo' || lower === 'command') {
      i++
      continue
    }
    if (lower === 'npm' && tokens[i + 1]?.toLowerCase() === 'run') {
      i += 2
      continue
    }
    break
  }
  if (i >= tokens.length) return null
  const tool = normalizeCommandWord(tokens[i]!.toLowerCase())
  const rest = tokens.slice(i + 1).map(t => t.toLowerCase())
  const isNoop =
    rest.some(t => NOOP_FLAG_TOKENS.has(t)) ||
    (rest.length > 0 && NOOP_SUBCOMMANDS.has(rest[0]!))
  return { tool, isNoop }
}

/**
 * Does this script contain a CONSUMED, non-no-op external command (LUM-605)?
 * "Consumed" — the discriminator that closes the C hole — means the external
 * command's output or exit actually reaches the check's verdict:
 *   - captured in a `$(...)` / backtick substitution (output → data → assertion);
 *   - piped into a downstream stage (`ext | …`);
 *   - the terminal command of the whole script (its exit status IS the verdict).
 * A non-terminal external word whose output is discarded (the decoy
 * `git --version && cat frozen.txt | grep`), or any no-op invocation, does NOT
 * ground EXTERNAL.
 */
function groundsExternal(script: string): boolean {
  const noComments = script.replace(/(^|\s)#[^\n]*/gm, ' ')
  return scanScript(noComments)
}

/** Pull out substitutions / `bash -c` payloads (recursing into them) then walk
 *  statements → `&&`/`||` segments → pipeline stages to test each consumed slot. */
function scanScript(text: string): boolean {
  let remaining = text
  let foundInNested = false
  remaining = remaining.replace(/\$\(([^)]*)\)/g, (_m, inner) => {
    if (scanConsumed(inner)) foundInNested = true
    return ' '
  })
  remaining = remaining.replace(/`([^`]*)`/g, (_m, inner) => {
    if (scanConsumed(inner)) foundInNested = true
    return ' '
  })
  remaining = remaining.replace(
    /\b(?:bash|sh)\b[^'"]*-c\s+'([^']*)'/g,
    (_m, payload) => {
      if (scanScript(payload)) foundInNested = true
      return ' '
    }
  )
  remaining = remaining.replace(
    /\b(?:bash|sh)\b[^'"]*-c\s+"([^"]*)"/g,
    (_m, payload) => {
      if (scanScript(payload)) foundInNested = true
      return ' '
    }
  )
  if (foundInNested) return true

  const statements = remaining
    .split(/;|\n/)
    .map(s => s.trim())
    .filter(Boolean)
  for (let si = 0; si < statements.length; si++) {
    const terminalStatement = si === statements.length - 1
    const segments = statements[si]!.split(/&&|\|\|/)
      .map(s => s.trim())
      .filter(Boolean)
    for (let gi = 0; gi < segments.length; gi++) {
      const terminalSegment = gi === segments.length - 1
      const stages = segments[gi]!.split(/\|/)
        .map(s => s.trim())
        .filter(Boolean)
      for (let pi = 0; pi < stages.length; pi++) {
        const finalStage = pi === stages.length - 1
        const inv = parseInvocation(stages[pi]!)
        if (!inv || !isExternalTool(inv.tool) || inv.isNoop) continue
        const pipedIntoConsumer = !finalStage
        const exitIsVerdict = finalStage && terminalSegment && terminalStatement
        if (pipedIntoConsumer || exitIsVerdict) return true
      }
    }
  }
  return false
}

/** Substitution context: the captured output is data fed to the surrounding
 *  assertion, so a non-no-op external command word in ANY position is consumed. */
function scanConsumed(inner: string): boolean {
  let remaining = inner
  let found = false
  remaining = remaining.replace(/\$\(([^)]*)\)/g, (_m, x) => {
    if (scanConsumed(x)) found = true
    return ' '
  })
  remaining = remaining.replace(/`([^`]*)`/g, (_m, x) => {
    if (scanConsumed(x)) found = true
    return ' '
  })
  if (found) return true
  const segments = remaining
    .split(/&&|\|\||;|\||\n/)
    .map(s => s.trim())
    .filter(Boolean)
  for (const seg of segments) {
    const inv = parseInvocation(seg)
    if (inv && isExternalTool(inv.tool) && !inv.isNoop) return true
  }
  return false
}

export function classifyCheckpointerGrounding(
  checkpointer: string | null | undefined
): CheckpointerGrounding {
  if (!checkpointer || checkpointer.trim() === '') return 'NONE'
  const lower = checkpointer.toLowerCase()
  // Fast path for known two-word external phrases (e.g. prisma migrate status)
  if (EXTERNAL_PHRASES.some(p => lower.includes(p))) return 'EXTERNAL'

  const words = collectCommandWords(lower)

  if (words.length === 0) return 'NONE'

  // Strongest signal wins: EXTERNAL > AGENT_HARNESS > ASSERTION_ONLY. EXTERNAL
  // is gated on a CONSUMED, non-no-op external command (LUM-605) — a no-op or
  // output-discarded external word falls through to harness/assertion.
  if (groundsExternal(lower)) return 'EXTERNAL'
  if (words.some(w => wordMatches(w, HARNESS_TOOLS))) return 'AGENT_HARNESS'
  return 'ASSERTION_ONLY'
}

export function effectiveReferentKind(args: {
  declared: DeclarableReferentKind | null
  verifierType: 'MACHINE' | 'HUMAN'
  checkpointer: string | null | undefined
}): EffectiveReferentKind {
  const { declared, verifierType, checkpointer } = args
  if (declared === null) return 'UNCLASSIFIED'
  if (declared === 'EXTERNAL_FACT' && verifierType === 'MACHINE') {
    if (classifyCheckpointerGrounding(checkpointer) !== 'EXTERNAL') {
      return 'UNVERIFIED_ASSERTION'
    }
  }
  return declared
}

/**
 * LUM-733: the referent kind is DERIVED by the system, not declared by the
 * agent. A MACHINE criterion's kind follows its checkpointer — EXTERNAL_FACT
 * only when the check actually consumes an external tool (git/gh/curl/psql/…),
 * AGENT_CONSTRUCTED_STATE otherwise — so any declaration on a MACHINE criterion
 * is ignored (there is nothing to mis-declare and nothing to catch). A HUMAN
 * criterion has no checkpointer to read, so an optional declaration is kept
 * as-is; absent, it stays null (unclassified).
 */
export function deriveReferentKind(args: {
  verifierType: 'MACHINE' | 'HUMAN'
  checkpointer: string | null | undefined
  declared?: string | null | undefined
}): TaskReferentKind | null {
  const { verifierType, checkpointer, declared } = args
  if (verifierType === 'MACHINE') {
    return classifyCheckpointerGrounding(checkpointer) === 'EXTERNAL'
      ? 'EXTERNAL_FACT'
      : 'AGENT_CONSTRUCTED_STATE'
  }
  return declared === 'EXTERNAL_FACT' || declared === 'AGENT_CONSTRUCTED_STATE'
    ? declared
    : null
}
