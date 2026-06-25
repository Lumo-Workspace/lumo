// Pure predicate evaluators — no I/O, no side effects.
// Glob matching is implemented inline (no picomatch dependency).
// Supports: ** (any path segments), * (within a single segment), literal chars.

/** Convert a glob pattern to a RegExp. */
function globToRegExp(glob: string): RegExp {
  // Escape all regex metacharacters except * which we handle specially
  const parts = glob.split('**')
  const escaped = parts
    .map(
      part =>
        part
          .split('*')
          .map(seg => seg.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*') // single * = any chars within one segment
    )
    .join('.*') // ** = any path segments (including separators)
  return new RegExp(`^${escaped}$`)
}

/**
 * Returns true if any of the changedPaths matches the glob.
 * Supports ** (cross-segment wildcard) and * (single-segment wildcard).
 */
export function matchPathGlob(glob: string, changedPaths: string[]): boolean {
  const re = globToRegExp(glob)
  return changedPaths.some(p => re.test(p))
}

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
