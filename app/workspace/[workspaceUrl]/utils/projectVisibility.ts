import type { ApiProject } from '../types'

/**
 * LUM-1285: the sidebar lists published, unarchived projects only. Archived
 * ones stay on the Projects page, where they can be opened and restored.
 */
export function isSidebarProject(
  p: Pick<ApiProject, 'isIdea' | 'archivedAt'>
): boolean {
  return !p.isIdea && !p.archivedAt
}
