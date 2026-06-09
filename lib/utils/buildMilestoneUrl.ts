import { slugify } from '@/lib/utils/slugify'

/** Absolute URL to a milestone, scoped under its project. `milestoneSlug` is the
 *  stored milestone slug (already slug-shaped). */
export function buildMilestoneUrl(
  workspaceSlug: string,
  projectName: string,
  milestoneSlug: string
): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${appUrl}/workspace/${workspaceSlug}/projects/${slugify(projectName)}/milestones/${milestoneSlug}`
}
