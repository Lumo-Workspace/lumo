/**
 * Pure parsing of MACHINE-criterion checkpointer command strings (LUM-436/441).
 *
 * A MACHINE checkpointer is a shell command; the prescribed form is
 *   npx tsx scripts/jest-t.ts '<exact test name>' [test file path…]
 * Two consumers need to read the *file paths* a checkpointer depends on:
 *   - the checkpointer-drift sweep (LUM-436/438) — does the test still exist?
 *   - the TEST_TAMPERING reward-hacking detector (LUM-441) — did an Edit/Write
 *     touch a file a MACHINE check depends on?
 * Both used to (or would) re-derive the tokenizer; this is the single source so
 * they never drift. No I/O — safe to unit-test exhaustively.
 */

/**
 * Split a shell-ish command into tokens, honoring single/double quotes so a
 * quoted test name with spaces stays one token. Quote characters are stripped;
 * we do not interpret escapes or variable expansion (not needed for the
 * prescribed checkpointer form).
 */
export function tokenize(cmd: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let inToken = false
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      inToken = true
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (inToken) {
        tokens.push(cur)
        cur = ''
        inToken = false
      }
      continue
    }
    cur += ch
    inToken = true
  }
  if (inToken) tokens.push(cur)
  return tokens
}

/** A jest-t.ts checkpointer parsed into its test name + scoped file paths. */
export interface ParsedJestT {
  name: string
  paths: string[]
}

/**
 * Parse a `…/jest-t.ts '<name>' <path…>` checkpointer into its test name and
 * file paths. Returns null for anything that is not a jest-t.ts invocation
 * (bash probes, bare `jest -t`, script calls) — those are not statically
 * resolvable and must never be flagged as drift.
 */
export function parseJestTCheckpointer(
  checkpointer: string
): ParsedJestT | null {
  const tokens = tokenize(checkpointer)
  const idx = tokens.findIndex(t => t.endsWith('jest-t.ts'))
  if (idx === -1) return null
  const name = tokens[idx + 1]
  if (!name) return null
  // Trailing args are the test file path(s); drop any jest flags (`--foo`).
  const paths = tokens.slice(idx + 2).filter(t => !t.startsWith('-'))
  return { name, paths }
}

/** A test/spec source path (the only token class the bare-jest fallback trusts). */
const TEST_PATH_RE = /\.(?:test|spec)\.[tj]sx?$/

/**
 * The set of test/check FILE PATHS a MACHINE checkpointer depends on (LUM-441).
 * For the prescribed `jest-t.ts '<name>' <path…>` form, that is the trailing
 * path args. For a bare `jest …` (or any other) command we conservatively keep
 * only tokens that *look* like a test source file (`*.test.ts`, `*.spec.tsx`,
 * …) — a checkpointer that references no resolvable test file yields `[]`, and
 * an empty set never matches an edit, so a checkpointer with no path (e.g. a
 * jest-by-name with no scope, or a bash probe) can never produce a false flag.
 */
export function checkpointerFilePaths(checkpointer: string): string[] {
  const parsed = parseJestTCheckpointer(checkpointer)
  if (parsed) return parsed.paths
  return tokenize(checkpointer).filter(
    t => !t.startsWith('-') && TEST_PATH_RE.test(t)
  )
}
