'use client'

import { useState } from 'react'
import { useIdeas } from '../../hooks/useIdeas'
import { usePlanRuns } from '../../hooks/usePlanRuns'
import { useIdeaGrouping } from '../../hooks/useIdeaGrouping'
import { useUpdateIdea } from '../../hooks/useUpdateIdea'
import { IdeaPoolView } from './IdeaPoolView'
import { IdeaDrawer } from '../IdeaDrawer'

/**
 * Container for the team idea-pool page. Owns data-fetching via `useIdeas` +
 * `usePlanRuns` + `useIdeaGrouping` and hands them to the presentational
 * `IdeaPoolView` (SRP split). Self-fetching like the sprints / milestone-detail
 * pages, so `WorkspaceApp` needn't prop-drill idea / plan-run / grouping state.
 *
 * Also owns the detail slide-over (LUM-683): a row click sets `selectedId`;
 * the open idea is re-derived from the live `ideas` list by id so an inline
 * statement edit (cache-patched by `useUpdateIdea`) reflects in the panel
 * without extra wiring.
 */
export function IdeaPoolPage({ workspaceUrl }: { workspaceUrl: string }) {
  const { ideas, loading, error, refetch } = useIdeas()
  const {
    runs: planRuns,
    loading: planRunsLoading,
    error: planRunsError,
  } = usePlanRuns()
  const { clustering } = useIdeaGrouping()
  const { updateStatement, saving } = useUpdateIdea()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIdea = selectedId
    ? (ideas.find(i => i.id === selectedId) ?? null)
    : null

  return (
    <>
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
        onOpenIdea={idea => setSelectedId(idea.id)}
      />
      {selectedIdea && (
        <IdeaDrawer
          idea={selectedIdea}
          workspaceUrl={workspaceUrl}
          saving={saving}
          onClose={() => setSelectedId(null)}
          onSave={async statement => {
            await updateStatement(selectedIdea.id, statement)
          }}
        />
      )}
    </>
  )
}
