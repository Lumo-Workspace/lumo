/**
 * Normalize a user-supplied task reference to canonical `LUM-<n>` form.
 * Accepts `LUM-267`, `lum-267`, and bare `267`. Returns null for anything
 * that is not a recognizable task id.
 */
export function normalizeTaskId(input: string): string | null {
  const trimmed = input.trim()
  const prefixed = trimmed.match(/^lum-?(\d+)$/i)
  if (prefixed) return `LUM-${prefixed[1]}`
  const bare = trimmed.match(/^(\d+)$/)
  if (bare) return `LUM-${bare[1]}`
  return null
}

/**
 * Turn an arbitrary human slug into a branch/dir-safe segment: lowercase,
 * non-alphanumeric runs collapse to a single dash, leading/trailing dashes
 * stripped.
 */
export function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** `lumo/LUM-267` or `lumo/LUM-267-<slug>`. */
export function deriveBranchName(taskId: string, slug?: string): string {
  const s = slug ? slugify(slug) : ''
  return s ? `lumo/${taskId}-${s}` : `lumo/${taskId}`
}

/** `.worktrees/` dir basename: `LUM-267` or `LUM-267-<slug>`. */
export function deriveWorktreeDirName(taskId: string, slug?: string): string {
  const s = slug ? slugify(slug) : ''
  return s ? `${taskId}-${s}` : taskId
}
