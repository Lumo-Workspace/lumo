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

export function classifyCheckpointerGrounding(
  checkpointer: string | null | undefined
): CheckpointerGrounding {
  if (!checkpointer || checkpointer.trim() === '') return 'NONE'
  const lower = checkpointer.toLowerCase()
  // Fast path for known two-word external phrases (e.g. prisma migrate status)
  if (EXTERNAL_PHRASES.some(p => lower.includes(p))) return 'EXTERNAL'

  const words = collectCommandWords(checkpointer.toLowerCase())

  if (words.length === 0) return 'NONE'

  // Strongest signal wins: EXTERNAL > AGENT_HARNESS > ASSERTION_ONLY
  if (words.some(w => wordMatches(w, EXTERNAL_TOOLS))) return 'EXTERNAL'
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
