import { slugify } from '@/lib/utils/slugify'
import { resolveAppUrl } from '@/lib/config/public-config'

/** Absolute URL to a project's overview page. */
export function buildProjectUrl(
  workspaceSlug: string,
  projectName: string
): string {
  const appUrl = resolveAppUrl() ?? 'http://localhost:3000'
  return `${appUrl}/workspace/${workspaceSlug}/projects/${slugify(projectName)}`
}
