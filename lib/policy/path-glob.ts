/**
 * LUM-1063 — path-glob matching, moved verbatim out of the policy predicate
 * evaluators (`lib/services/policy/predicate-eval.ts`, which re-exports it).
 * Pure. The core sensitive-path-edit detector applies a project's glob
 * override with it; the policy compiler that produces those globs is a
 * plugin.
 *
 * Supports: ** (any path segments), * (within a single segment), literal chars.
 */

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
