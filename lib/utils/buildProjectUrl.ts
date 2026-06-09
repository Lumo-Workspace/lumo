import { slugify } from '@/lib/utils/slugify'

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.uselumo.ai'

/** Absolute URL to a project's overview page. */
export function buildProjectUrl(workspaceSlug: string, projectName: string): string {
  return `${appUrl}/workspace/${workspaceSlug}/projects/${slugify(projectName)}`
}
