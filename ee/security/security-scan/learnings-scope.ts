/**
 * LUM-1134 — the workspace's learnings scope:
 * which repositories' PR-review learnings
 * (LUM-1131) the AI review of a repository reads.
 *
 * - `local`  — the reviewed repository's learnings only.
 * - `global` — every repository of this workspace (never another workspace).
 * - `auto`   — the default: local for a public repository, global for a
 *   private one. A visibility Lumo could not read counts as public (local):
 *   a public repository's review must never carry a private repository's
 *   learnings.
 *
 * PURE.
 */

export const LEARNINGS_SCOPES = ['local', 'global', 'auto'] as const
export type LearningsScope = (typeof LEARNINGS_SCOPES)[number]

export const DEFAULT_LEARNINGS_SCOPE: LearningsScope = 'auto'

/** The reviewed repository's visibility, as GitHub reported it (or not). */
export type RepoVisibility = 'public' | 'private' | 'unknown'

/** A stored value; anything unrecognised reads as the default. */
export function parseLearningsScope(value: unknown): LearningsScope {
  return typeof value === 'string' &&
    (LEARNINGS_SCOPES as readonly string[]).includes(value)
    ? (value as LearningsScope)
    : DEFAULT_LEARNINGS_SCOPE
}

/** Does this review read the workspace's other repositories' learnings? */
export function readsOtherRepositories(
  scope: LearningsScope,
  visibility: RepoVisibility
): boolean {
  if (scope === 'global') return true
  if (scope === 'local') return false
  return visibility === 'private'
}
