import { slugify } from '@/lib/utils/slugify'

// CUIDs are `c` + 24 lowercase alphanumerics. Any URL segment that doesn't
// match this is treated as a slug. A slug that happens to look like a cuid is
// extremely unlikely in practice; if it ever happens the user can rename the
// milestone to disambiguate.
export const MILESTONE_CUID_RE = /^c[a-z0-9]{24}$/

interface ProjectRef {
  id: string
  name: string
}

/**
 * Resolve the project addressed by a milestone-detail URL's project segment.
 * The milestone list row builds that segment from the project **slug**
 * (`slugify(name)`), so we match by slugified name first; matching by **cuid**
 * is kept as a fallback for legacy URLs (pre-LUM-126 links, CLI-built ids,
 * bookmarks, stale bundles). Returns null when no project matches, or the
 * segment / project list is missing.
 */
export function findProjectForMilestoneSegment<T extends ProjectRef>(
  projects: T[],
  segment: string | undefined
): T | null {
  if (!segment) return null
  return (
    projects.find(p => slugify(p.name) === segment) ??
    projects.find(p => p.id === segment) ??
    null
  )
}

interface MilestonePathParams {
  workspaceUrl: string | undefined
  projectSlug: string | undefined
  milestoneId: string | undefined
}

interface MilestoneRef {
  slug: string
}

/**
 * Returns the canonical slug-based milestone detail URL when either URL segment
 * differs from its canonical slug form, or null when no redirect is needed
 * (both segments already canonical, milestone not loaded, missing params, or
 * milestone has no slug).
 *
 * Both segments are canonicalized to the human-readable slug:
 *  - project segment   → `slugify(projectName)`
 *  - milestone segment → `milestone.slug`
 *
 * Legacy cuid URLs (pre-LUM-126 links, CLI-built ids, bookmarks, stale bundles)
 * thus settle on the slug URL. `projectName` comes from the resolved project;
 * when it isn't loaded yet the project segment is left as-is and only the
 * milestone segment is canonicalized — a later pass fixes the project segment
 * once the projects list resolves.
 */
export function getCanonicalMilestonePath(
  params: MilestonePathParams,
  milestone: MilestoneRef | null,
  projectName: string | undefined
): string | null {
  if (!milestone || !milestone.slug) return null
  if (!params.workspaceUrl || !params.projectSlug || !params.milestoneId) {
    return null
  }
  const canonicalProject = projectName
    ? slugify(projectName)
    : params.projectSlug
  const canonicalMilestone = milestone.slug
  if (
    params.projectSlug === canonicalProject &&
    params.milestoneId === canonicalMilestone
  ) {
    return null
  }
  return `/workspace/${params.workspaceUrl}/projects/${canonicalProject}/milestones/${canonicalMilestone}`
}
