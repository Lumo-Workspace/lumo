import WorkspaceApp from '../../WorkspaceApp'

/**
 * Sprint detail page.
 * Auth + workspace access are already validated by the parent WorkspaceLayout.
 * Routing to the sprint-detail view (and sprintId extraction) is handled by
 * WorkspaceApp via pathToPage + SprintDetailClient's useParams.
 */
export default function SprintDetailPage() {
  return <WorkspaceApp />
}
