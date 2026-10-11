import { Page } from '../types'

/**
 * Inverse of `pageToPath`: parse a workspace pathname into a `Page` plus the
 * trailing slug/id segment for routes that have one (project-detail,
 * document-editor, sprint-detail).
 *
 * Defaults to `my-tasks` when the path doesn't match any known route — the
 * workspace landing route shape is "redirect-on-empty" rather than throwing.
 */
export function pathToPage(
  pathname: string,
  workspaceUrl: string
): {
  page: Page
  projectSlug?: string | undefined
  milestoneId?: string | undefined
} {
  const base = `/workspace/${workspaceUrl}`
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : ''

  if (rest.startsWith('/documents/')) {
    const docId = rest.slice('/documents/'.length).split('/')[0]
    return { page: 'document-editor', projectSlug: docId }
  }
  if (rest.startsWith('/documents')) return { page: 'documents' }
  if (rest.startsWith('/run-reviews')) return { page: 'run-reviews' }
  if (rest.startsWith('/dashboard')) return { page: 'dashboard' }
  if (rest.startsWith('/inbox')) return { page: 'inbox' }
  if (rest.startsWith('/projects/')) {
    const after = rest.slice('/projects/'.length)
    const [projectSlug, segment, milestoneId] = after.split('/')
    if (segment === 'milestones' && milestoneId) {
      return { page: 'milestone-detail', projectSlug, milestoneId }
    }
    return { page: 'project-detail', projectSlug }
  }
  if (rest.startsWith('/projects')) return { page: 'projects' }
  if (rest.startsWith('/drafts')) return { page: 'drafts' }
  if (rest.startsWith('/sprints/')) {
    const sprintId = rest.slice('/sprints/'.length).split('/')[0]
    return { page: 'sprint-detail', projectSlug: sprintId }
  }
  if (rest.startsWith('/sprints')) return { page: 'sprints' }
  return { page: 'my-tasks' }
}
