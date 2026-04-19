import { SprintsLandingClient } from './components/SprintsLandingClient'

/**
 * Sprints landing page.
 * Auth + workspace access are already validated by the parent WorkspaceLayout.
 * Client-side data fetching is delegated to SprintsLandingClient.
 */
export default function SprintsPage() {
  return <SprintsLandingClient />
}
