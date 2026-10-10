// Pure predicate evaluators — no I/O, no side effects.
// Glob matching is implemented inline (no picomatch dependency).
// Supports: ** (any path segments), * (within a single segment), literal chars.

// LUM-1063: glob matching lives in the core (`lib/policy/path-glob`).
export { matchPathGlob } from '@/lib/policy/path-glob'

/**
 * Returns true if sub appears as a literal substring of command (case-sensitive).
 */
export function matchCmdSubstr(sub: string, command: string): boolean {
  return command.includes(sub)
}

/**
 * Tests the regex against the provided added lines only.
 * addedLines must be pre-stripped of the leading '+' from unified diff format.
 * Guards against invalid regex patterns (returns { matched: false }).
 */
export function matchDiffRegex(
  re: string,
  addedLines: string[]
): { matched: boolean; line?: string } {
  if (re.length > 200) return { matched: false }
  let rx: RegExp
  try {
    rx = new RegExp(re)
  } catch {
    return { matched: false }
  }
  for (const line of addedLines) {
    if (rx.test(line)) return { matched: true, line }
  }
  return { matched: false }
}
