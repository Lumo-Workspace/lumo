import { slugify } from '@/lib/utils/slugify'

/**
 * Build a full URL to a task page.
 *
 * The canonical task route is project-scoped:
 * `/workspace/{slug}/projects/{projectSlug}/tasks/{IDENTIFIER}`. The old bare
 * `/tasks/{identifier}` route was removed (commit fd45a18b), so callers must
 * supply the project name (slugified here) to build a non-404 link.
 */
export function buildTaskUrl(
  workspaceSlug: string,
  projectName: string,
  teamIdentifier: string,
  taskNumber: number
): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${appUrl}/workspace/${workspaceSlug}/projects/${slugify(projectName)}/tasks/${teamIdentifier}-${taskNumber}`
}

/**
 * Build a task identifier string, e.g. "LUM-42".
 */
export function buildTaskIdentifier(
  teamIdentifier: string,
  taskNumber: number
): string {
  return `${teamIdentifier}-${taskNumber}`
}
