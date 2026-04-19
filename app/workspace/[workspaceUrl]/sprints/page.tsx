import WorkspaceApp from '../WorkspaceApp'

/**
 * Sprints landing page.
 * Auth + workspace access are already validated by the parent WorkspaceLayout.
 * Routing to the sprints landing view is handled by WorkspaceApp's pathToPage.
 */
export default function SprintsPage() {
  return <WorkspaceApp />
}
