'use client'

import { useIntl } from 'react-intl'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { planRunsClient } from '@/lib/api-client/plan-runs'
import { Spinner } from '@/components/ui/spinner'
import { GateBBoard } from './GateBBoard'
import { GateCView } from './GateCView'

/**
 * Deep-link gate dispatcher (`/workspace/<slug>/plan/<runId>`, the target of
 * `lumo plan` / `lumo plan status`). Reads the run's stage and renders the gate
 * board that is currently open: Gate B (闸门B · 对齐) at ALIGNMENT_READY, Gate C
 * (闸门C · 物化) at DRAFT_READY. Transitional stages (an LLM segment running)
 * show a spinner; terminal / non-gate stages show a plain status line.
 */
export function PlanRunGate({
  runId,
  workspaceUrl,
}: {
  runId: string
  workspaceUrl: string
}) {
  const intl = useIntl()
  const qc = useQueryClient()

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.planRuns.run(runId),
    queryFn: () => planRunsClient.getRun(runId),
    // While an LLM segment runs the stage flips server-side; keep it fresh.
    refetchInterval: q =>
      q.state.data && isTransitional(q.state.data.stage) ? 3000 : false,
  })

  if (isLoading) {
    return (
      <div className='mx-auto flex max-w-3xl items-center gap-2 p-8 text-muted-foreground'>
        <Spinner /> {intl.formatMessage({ id: 'plan.gateC.loading' })}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className='mx-auto max-w-3xl p-8'>
        <p className='text-destructive'>
          {intl.formatMessage({ id: 'plan.gateC.loadError' })}
        </p>
      </div>
    )
  }

  if (data.stage === 'ALIGNMENT_READY') {
    return (
      <div className='mx-auto max-w-3xl p-8'>
        <GateBBoard
          runId={runId}
          onConfirmed={() =>
            qc.invalidateQueries({ queryKey: queryKeys.planRuns.run(runId) })
          }
        />
      </div>
    )
  }

  if (data.stage === 'DRAFT_READY') {
    return <GateCView runId={runId} workspaceUrl={workspaceUrl} />
  }

  if (isTransitional(data.stage)) {
    return (
      <div className='mx-auto flex max-w-3xl items-center gap-2 p-8 text-muted-foreground'>
        <Spinner /> {intl.formatMessage({ id: 'planGate.working' })}
      </div>
    )
  }

  return (
    <div className='mx-auto max-w-3xl p-8 text-muted-foreground'>
      {intl.formatMessage(
        { id: 'planGate.notActionable' },
        { stage: data.stage }
      )}
    </div>
  )
}

/** Stages where an LLM segment is running — the gate opens shortly. */
function isTransitional(stage: string): boolean {
  return (
    stage === 'CLUSTERING' || stage === 'ALIGNING' || stage === 'GENERATING'
  )
}
