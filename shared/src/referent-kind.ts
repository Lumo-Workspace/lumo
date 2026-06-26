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

/**
 * Split a checkpointer command into candidate command words: strip shell
 * meta (|, &&, ||, ;, (), backticks, $()) and quotes, then take whitespace
 * tokens. `npx <tool>` and `npm run <script>` reduce to the tool word.
 */
function commandWords(checkpointer: string): string[] {
  const cleaned = checkpointer
    .replace(/['"`]/g, ' ')
    .replace(/[()|;&]/g, ' ')
    .replace(/\$\{?/g, ' ')
  const raw = cleaned.split(/\s+/).filter(Boolean)
  const words: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i]
    if (w === undefined) continue
    if (w === 'npx' || w === 'sudo' || w === 'command') continue // skip wrappers
    if (w === 'npm' && raw[i + 1] === 'run') {
      i++
      continue
    }
    // strip a leading path: scripts/jest-t.ts → jest-t.ts (keep basename)
    const slash = w.lastIndexOf('/')
    const word = slash >= 0 ? w.slice(slash + 1) : w
    words.push(word)
  }
  return words
}

function wordMatches(word: string, tools: string[]): boolean {
  // exact tool, or a tool-prefixed filename like jest-t.ts / vitest.config
  return tools.some(
    t => word === t || word.startsWith(`${t}-`) || word.startsWith(`${t}.`)
  )
}

export function classifyCheckpointerGrounding(
  checkpointer: string | null | undefined
): CheckpointerGrounding {
  if (!checkpointer || checkpointer.trim() === '') return 'NONE'
  const lower = checkpointer.toLowerCase()
  if (EXTERNAL_PHRASES.some(p => lower.includes(p))) return 'EXTERNAL'
  const words = commandWords(lower)
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
