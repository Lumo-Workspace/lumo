'use client'

import { useIdeas } from '../../hooks/useIdeas'
import { usePlanRuns } from '../../hooks/usePlanRuns'
import { IdeaPoolView } from './IdeaPoolView'

/**
 * Container for the team idea-pool page. Owns data-fetching via `useIdeas` +
 * `usePlanRuns` and hands both to the presentational `IdeaPoolView` (SRP
 * split). Self-fetching like the sprints / milestone-detail pages, so
 * `WorkspaceApp` needn't prop-drill idea or plan-run state.
 */
export function IdeaPoolPage({ workspaceUrl }: { workspaceUrl: string }) {
  const { ideas, loading, error, refetch } = useIdeas()
  const {
    runs: planRuns,
    loading: planRunsLoading,
    error: planRunsError,
  } = usePlanRuns()

  return (
    <IdeaPoolView
      ideas={ideas}
      loading={loading}
      error={error}
      onRetry={() => {
        void refetch()
      }}
      workspaceUrl={workspaceUrl}
      planRuns={planRuns}
      planRunsLoading={planRunsLoading}
      planRunsError={planRunsError}
    />
  )
}
