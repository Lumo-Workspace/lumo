import WorkspaceApp from '../../WorkspaceApp'

/**
 * Initiative detail page (LUM-673).
 * Auth + workspace access are validated by the parent WorkspaceLayout.
 * Routing to the initiative detail view (and reading the `initiativeId`
 * segment) is handled by WorkspaceApp's pathToPage + the detail component's
 * `useParams`.
 */
export default function InitiativeDetailRoute() {
  return <WorkspaceApp />
}
