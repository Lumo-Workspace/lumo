import WorkspaceApp from '../WorkspaceApp'

/**
 * Initiatives landing page (LUM-673).
 * Auth + workspace access are validated by the parent WorkspaceLayout.
 * Routing to the initiatives landing view is handled by WorkspaceApp's
 * pathToPage.
 */
export default function InitiativesPage() {
  return <WorkspaceApp />
}
