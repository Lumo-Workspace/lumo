'use client'

import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { planRunsClient } from '@/lib/api-client/plan-runs'
import { Spinner } from '@/components/ui/spinner'
import { Button } from '@/components/ui/button'
import { ClusterGateBoard } from './ClusterGateBoard'
import { GateBBoard } from './GateBBoard'
import { GateCView } from './GateCView'

/**
 * Deep-link gate dispatcher (`/workspace/<slug>/plan/<runId>`, the target of
 * `lumo plan` / `lumo plan status`). Reads the run's stage and renders the gate
 * board that is currently open: Gate A (闸门A · 聚类) at CLUSTERS_READY, Gate B
 * (闸门B · 对齐) at ALIGNMENT_READY, Gate C (闸门C · 物化) at DRAFT_READY.
 * Transitional stages (an LLM segment running) show a spinner; terminal /
 * non-gate stages show a plain status line.
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
        <p className='text-danger-text'>
          {intl.formatMessage({ id: 'plan.gateC.loadError' })}
        </p>
      </div>
    )
  }

  if (data.stage === 'CLUSTERS_READY') {
    // Wider than the other gates on purpose: A is a multi-column board, not a
    // prose column, and max-w-3xl left each cluster too narrow to read (LUM-685).
    return (
      <div className='mx-auto max-w-5xl p-8'>
        <ClusterGateBoard
          runId={runId}
          onConfirmed={() =>
            qc.invalidateQueries({ queryKey: queryKeys.planRuns.run(runId) })
          }
        />
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

  // A working stage and FAILED share one screen: both mean "a step is not
  // done", and both are recovered the same way — re-dispatch that step. Before
  // LUM-689 a working stage was a bare spinner with no way out, and FAILED fell
  // through to the generic non-actionable line.
  if (isTransitional(data.stage) || data.stage === 'FAILED') {
    return <StuckStage runId={runId} failed={data.stage === 'FAILED'} />
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

/**
 * The "nothing to confirm yet" screen: an LLM segment is running, or it failed.
 * Either way the only useful action is to re-run that segment, so both states
 * render the same retry control — a spinner alone leaves a wedged run (the
 * shape that motivated LUM-689) with no exit at all.
 */
function StuckStage({ runId, failed }: { runId: string; failed: boolean }) {
  const intl = useIntl()
  const qc = useQueryClient()

  const retry = useMutation({
    mutationFn: () => planRunsClient.retry(runId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.planRuns.run(runId) }),
  })

  return (
    <div className='mx-auto flex max-w-3xl flex-col items-start gap-4 p-8'>
      {failed ? (
        <p className='text-danger-text'>
          {intl.formatMessage({ id: 'planGate.failed' })}
        </p>
      ) : (
        <p className='flex items-center gap-2 text-muted-foreground'>
          <Spinner /> {intl.formatMessage({ id: 'planGate.working' })}
        </p>
      )}

      <div className='flex flex-col items-start gap-2'>
        <Button
          variant='outline'
          size='sm'
          onClick={() => retry.mutate()}
          disabled={retry.isPending}
        >
          {intl.formatMessage({
            id: retry.isPending ? 'planGate.retrying' : 'planGate.retry',
          })}
        </Button>
        <p className='text-xs text-muted-foreground'>
          {intl.formatMessage({ id: 'planGate.retryHint' })}
        </p>
        {retry.isError && (
          <p className='text-xs text-danger-text'>
            {intl.formatMessage({ id: 'planGate.retryFailed' })}
          </p>
        )}
      </div>
    </div>
  )
}

/** Stages where an LLM segment is running — the gate opens shortly. */
function isTransitional(stage: string): boolean {
  return (
    stage === 'CLUSTERING' || stage === 'ALIGNING' || stage === 'GENERATING'
  )
}
