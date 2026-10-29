import { slugify } from '@/lib/utils/slugify'
import { resolveAppUrl } from '@/lib/config/public-config'

/** Absolute URL to a milestone, scoped under its project. `milestoneSlug` is the
 *  stored milestone slug (already slug-shaped). */
export function buildMilestoneUrl(
  workspaceSlug: string,
  projectName: string,
  milestoneSlug: string
): string {
  const appUrl = resolveAppUrl() ?? 'http://localhost:3000'
  return `${appUrl}/workspace/${workspaceSlug}/projects/${slugify(projectName)}/milestones/${milestoneSlug}`
}
