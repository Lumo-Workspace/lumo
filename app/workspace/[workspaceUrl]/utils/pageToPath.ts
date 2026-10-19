import { Page } from '../types'
import { slugify } from '@/lib/utils/slugify'

/**
 * Convert a Page to its URL path.
 * Used by WorkspaceApp for pushState and by TaskDetailPage for navigation.
 *
 * The `project` argument is overloaded — for the `document-editor` page it
 * carries the doc's URL identifier (`slug` for real docs; `id` for the
 * optimistic `temp-uuid` window before the server assigns a slug).
 */
export function pageToPath(
  workspaceUrl: string,
  page: Page,
  project?: {
    name: string
    id?: string
    slug?: string
    number?: number
  } | null
): string {
  const base = `/workspace/${workspaceUrl}`
  switch (page) {
    case 'my-tasks':
      return `${base}/my-tasks`
    case 'inbox':
      return `${base}/inbox`
    case 'projects':
      return `${base}/projects`
    case 'project-detail':
      return project
        ? `${base}/projects/${slugify(project.name)}`
        : `${base}/projects`
    case 'documents':
      return `${base}/documents`
    case 'document-editor':
      return `${base}/documents/${project?.slug ?? project?.id ?? ''}`
    case 'drafts':
      return `${base}/drafts`
    case 'sprints':
      return `${base}/sprints`
    case 'sprint-detail':
      return project?.number
        ? `${base}/sprints/${project.number}`
        : `${base}/sprints`
    default:
      return `${base}/my-tasks`
  }
}
