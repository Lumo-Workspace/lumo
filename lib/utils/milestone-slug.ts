const FALLBACK_BASE = 'milestone'

/**
 * Build a base slug from a milestone name. Replaces every run of
 * non-alphanumeric characters with a single `-`, matching the PostgreSQL
 * backfill in migration `20260523065320_add_milestone_slug` so service-time and
 * backfill slugs stay in sync (e.g. "v1.0" → "v1-0", not "v10"). Falls back to
 * "milestone" when the name has no ASCII alphanumerics (e.g. all-CJK names).
 */
export function buildMilestoneSlugBase(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return base.length > 0 ? base : FALLBACK_BASE
}

/**
 * Resolve a unique slug for a milestone within a project. Tries `base`, then
 * `base-2`, `base-3`, ... against the supplied `existingSlugs` set.
 *
 * The caller is responsible for fetching the set inside the same transaction
 * as the insert if strict uniqueness is required; the DB unique index is the
 * source of truth.
 */
export function resolveUniqueMilestoneSlug(
  base: string,
  existingSlugs: ReadonlySet<string>
): string {
  if (!existingSlugs.has(base)) return base
  let n = 2
  while (existingSlugs.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}
