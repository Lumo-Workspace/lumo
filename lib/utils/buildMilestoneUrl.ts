import { slugify } from '@/lib/utils/slugify'

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.uselumo.ai'

/** Absolute URL to a milestone, scoped under its project. `milestoneSlug` is the
 *  stored milestone slug (already slug-shaped). */
export function buildMilestoneUrl(
  workspaceSlug: string,
  projectName: string,
  milestoneSlug: string
): string {
  return `${appUrl}/workspace/${workspaceSlug}/projects/${slugify(projectName)}/milestones/${milestoneSlug}`
}
