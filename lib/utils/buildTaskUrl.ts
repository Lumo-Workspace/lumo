import { slugify } from '@/lib/utils/slugify'
import { resolveAppUrl } from '@/lib/config/public-config'

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
  const appUrl = resolveAppUrl() ?? 'http://localhost:3000'
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

/**
 * URL of the My Tasks page, or of one task under it when `identifier` is
 * given. `/my-tasks/{IDENTIFIER}` needs no project slug — the page redirects
 * to the canonical project URL when the task is not the viewer's — so it is
 * the link for a task whose project name is unknown (never `/projects//`).
 */
export function buildMyTasksUrl(
  workspaceSlug: string,
  identifier?: string
): string {
  const appUrl = resolveAppUrl() ?? 'http://localhost:3000'
  const base = `${appUrl}/workspace/${workspaceSlug}/my-tasks`
  return identifier ? `${base}/${identifier}` : base
}
