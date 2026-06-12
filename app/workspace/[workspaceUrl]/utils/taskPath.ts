import { slugify } from '@/lib/utils/slugify'

/**
 * Canonical projects-based URL for a task, used when the my-tasks route
 * redirects a task that isn't assigned to the current user.
 *
 * The active tab lives in an optional path segment (LUM-458), so the redirect
 * must carry `tab?.[0]` through to the canonical URL — otherwise a shared deep
 * link like `/my-tasks/LUM-1/acceptance` (someone else's task) would land on
 * the projects URL's default Comments tab (LUM-460 follow-up 2).
 *
 * The tab slug is passed through verbatim — no validation. An unknown or
 * currently-hidden slug is self-healed by `TimelineTabs` on the target page
 * (it falls back to Comments and strips the dead segment).
 */
export function buildMyTaskRedirectPath(
  workspaceUrl: string,
  projectName: string,
  identifier: string,
  tab?: string[] | undefined
): string {
  const tabSlug = tab?.[0]
  const tabSegment = tabSlug ? `/${tabSlug}` : ''
  return `/workspace/${workspaceUrl}/projects/${slugify(projectName)}/tasks/${identifier}${tabSegment}`
}
