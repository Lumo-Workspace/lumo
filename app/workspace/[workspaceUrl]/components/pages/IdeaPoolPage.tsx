'use client'

import { useIdeas } from '../../hooks/useIdeas'
import { IdeaPoolView } from './IdeaPoolView'

/**
 * Container for the team idea-pool page. Owns data-fetching via `useIdeas` and
 * hands the pool to the presentational `IdeaPoolView` (SRP split). Self-fetching
 * like the sprints / milestone-detail pages, so `WorkspaceApp` needn't
 * prop-drill idea state.
 */
export function IdeaPoolPage({ workspaceUrl }: { workspaceUrl: string }) {
  const { ideas, loading, error, refetch } = useIdeas()

  return (
    <IdeaPoolView
      ideas={ideas}
      loading={loading}
      error={error}
      onRetry={() => {
        void refetch()
      }}
      workspaceUrl={workspaceUrl}
    />
  )
}
