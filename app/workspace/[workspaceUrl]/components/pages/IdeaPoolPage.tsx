'use client'

import { useState } from 'react'
import { useIdeas } from '../../hooks/useIdeas'
import { usePlanRuns } from '../../hooks/usePlanRuns'
import { useIdeaGrouping } from '../../hooks/useIdeaGrouping'
import { useUpdateIdea } from '../../hooks/useUpdateIdea'
import { useCaptureIdea } from '../../hooks/useCaptureIdea'
import { useUpdateIdeaStatus } from '../../hooks/useUpdateIdeaStatus'
import { IdeaPoolView } from './IdeaPoolView'
import { IdeaDrawer } from '../IdeaDrawer'

/**
 * Container for the team idea-pool page. Owns data-fetching via `useIdeas` +
 * `usePlanRuns` + `useIdeaGrouping` and hands them to the presentational
 * `IdeaPoolView` (SRP split). Self-fetching like the sprints / milestone-detail
 * pages, so `WorkspaceApp` needn't prop-drill idea / plan-run / grouping state.
 *
 * Owns the pool's mutations too (LUM-708): inline capture and the row badge's
 * status advance are container-level so the view stays presentational — both
 * patch the pool cache in place, so a captured idea and a moved badge land
 * without a refetch.
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
  const { capture } = useCaptureIdea()
  const { updateStatus } = useUpdateIdeaStatus()

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
        onCaptureIdea={capture}
        onAdvanceStatus={(idea, next) => updateStatus(idea.id, next)}
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
