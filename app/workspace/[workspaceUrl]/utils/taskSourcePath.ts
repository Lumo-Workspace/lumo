import { slugify } from '@/lib/utils/slugify'

/**
 * Canonical "parent" URL for a task-detail page, derived from where the user
 * came from. This is the single source of truth shared by the breadcrumb
 * back-link and the post-delete redirect so the two never drift.
 *
 * `from === 'my-tasks'` returns the my-tasks list; every other value (including
 * null — the "came from a project" default — or any stale/unknown source) falls
 * through to the task's project list, addressed by the slugified project name.
 *
 * Navigating here explicitly is intentional: it does not depend on the browser
 * history stack, so it behaves correctly on direct-link / deep-link / refresh
 * entry where `router.back()` would land somewhere unrelated (or on the
 * now-deleted task).
 */
export function taskSourcePath(
  workspaceUrl: string,
  from: string | null,
  projectName: string
): string {
  return from === 'my-tasks'
    ? `/workspace/${workspaceUrl}/my-tasks`
    : `/workspace/${workspaceUrl}/projects/${slugify(projectName)}`
}
