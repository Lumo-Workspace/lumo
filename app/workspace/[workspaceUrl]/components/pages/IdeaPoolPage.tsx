'use client'

import { useIdeas } from '../../hooks/useIdeas'
import { usePlanRuns } from '../../hooks/usePlanRuns'
import { useIdeaGrouping } from '../../hooks/useIdeaGrouping'
import { IdeaPoolView } from './IdeaPoolView'

/**
 * Container for the team idea-pool page. Owns data-fetching via `useIdeas` +
 * `usePlanRuns` + `useIdeaGrouping` and hands them to the presentational
 * `IdeaPoolView` (SRP split). Self-fetching like the sprints / milestone-detail
 * pages, so `WorkspaceApp` needn't prop-drill idea / plan-run / grouping state.
 */
export function IdeaPoolPage({ workspaceUrl }: { workspaceUrl: string }) {
  const { ideas, loading, error, refetch } = useIdeas()
  const {
    runs: planRuns,
    loading: planRunsLoading,
    error: planRunsError,
  } = usePlanRuns()
  const { clustering } = useIdeaGrouping()

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
      clustering={clustering}
    />
  )
}
