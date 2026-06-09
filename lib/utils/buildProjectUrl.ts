import { slugify } from '@/lib/utils/slugify'

/** Absolute URL to a project's overview page. */
export function buildProjectUrl(workspaceSlug: string, projectName: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${appUrl}/workspace/${workspaceSlug}/projects/${slugify(projectName)}`
}
