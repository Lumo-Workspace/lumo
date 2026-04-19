import { SprintDetailClient } from './SprintDetailClient'

/**
 * Sprint detail page.
 * Auth + workspace access are already validated by the parent WorkspaceLayout.
 * Client-side data fetching is delegated to SprintDetailClient.
 */
export default function SprintDetailPage() {
  return <SprintDetailClient />
}
