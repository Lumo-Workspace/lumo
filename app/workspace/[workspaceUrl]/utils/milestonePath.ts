// CUIDs are `c` + 24 lowercase alphanumerics. Any URL segment that doesn't
// match this is treated as a slug. A slug that happens to look like a cuid is
// extremely unlikely in practice; if it ever happens the user can rename the
// milestone to disambiguate.
export const MILESTONE_CUID_RE = /^c[a-z0-9]{24}$/

interface MilestonePathParams {
  workspaceUrl: string | undefined
  projectSlug: string | undefined
  milestoneId: string | undefined
}

interface MilestoneRef {
  slug: string
}

/**
 * Returns the canonical slug-based milestone detail URL when the current URL
 * segment is a cuid, or null when no redirect is needed (segment already a
 * slug, milestone not loaded, missing params, or milestone has no slug).
 *
 * The project segment is passed through as-is — project slug routing is
 * intentionally out of scope (LUM-71).
 */
export function getCanonicalMilestonePath(
  params: MilestonePathParams,
  milestone: MilestoneRef | null
): string | null {
  if (!milestone || !milestone.slug) return null
  if (!params.workspaceUrl || !params.projectSlug || !params.milestoneId) {
    return null
  }
  if (!MILESTONE_CUID_RE.test(params.milestoneId)) return null
  if (params.milestoneId === milestone.slug) return null
  return `/workspace/${params.workspaceUrl}/projects/${params.projectSlug}/milestones/${milestone.slug}`
}
