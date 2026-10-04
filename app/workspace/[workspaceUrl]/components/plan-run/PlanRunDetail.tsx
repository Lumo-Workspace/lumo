'use client'

import { useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import type { PlanRunStage, PlanStageKind } from '@prisma/client'
import { queryKeys } from '@/lib/query/keys'
import { planRunsClient } from '@/lib/api-client/plan-runs'
import type { PlanRunArchiveStage } from '@/lib/api-client/plan-runs'
import { isTerminalStage } from '@/lib/plan-run/state-machine'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import { PlanRunGate } from './PlanRunGate'

/**
 * Plan-run detail view (LUM-677). Renders per state:
 *  • an active run (non-terminal stage) → the gate dispatcher, so it stays
 *    resumable at its current gate;
 *  • a terminal run (MATERIALIZED / ABANDONED / FAILED) → a read-only archive:
 *    what was clustered, each gate's human-confirmed decision, and the
 *    materialized Initiative(s) for lineage.
 *
 * The `/workspace/<slug>/plan/<runId>` page mounts this, so the CLI deep-link
 * and the Ideas-page plan-runs surface both land here and get the right view.
 */
export function PlanRunDetail({
  runId,
  workspaceUrl,
}: {
  runId: string
  workspaceUrl: string
}) {
  const intl = useIntl()

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.planRuns.run(runId),
    queryFn: () => planRunsClient.getRun(runId),
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
          {intl.formatMessage({ id: 'planRuns.loadError' })}
        </p>
      </div>
    )
  }

  // Active run → keep it resumable at its current gate. (`getRun` types stage
  // as a plain string; it is a PlanRunStage on the wire.)
  if (!isTerminalStage(data.stage as PlanRunStage)) {
    return <PlanRunGate runId={runId} workspaceUrl={workspaceUrl} />
  }

  // Terminal run → read-only archive.
  return <PlanRunArchiveView runId={runId} workspaceUrl={workspaceUrl} />
}

const STATUS_MESSAGE: Record<string, string> = {
  MATERIALIZED: 'planRuns.status.materialized',
  ABANDONED: 'planRuns.status.abandoned',
  FAILED: 'planRuns.status.failed',
}

const GATE_MESSAGE: Record<PlanStageKind, string> = {
  CLUSTER: 'planRuns.gate.cluster',
  ALIGN: 'planRuns.gate.align',
  GENERATE: 'planRuns.gate.generate',
}

/** Read-only archive of a terminal run. */
function PlanRunArchiveView({
  runId,
  workspaceUrl,
}: {
  runId: string
  workspaceUrl: string
}) {
  const intl = useIntl()

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.planRuns.archive(runId),
    queryFn: () => planRunsClient.getArchive(runId),
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
          {intl.formatMessage({ id: 'planRuns.loadError' })}
        </p>
      </div>
    )
  }

  const clusterRecord = data.stageRecords.find(r => r.kind === 'CLUSTER')
  const clusters = clusterRecord ? clusterNames(clusterRecord) : []

  return (
    <div className='mx-auto flex max-w-3xl flex-col gap-6 p-8'>
      <div className='flex items-center gap-2'>
        <h1 className='text-lg font-semibold'>
          {intl.formatMessage({ id: 'planRuns.archiveTitle' })}
        </h1>
        <Badge variant='outline'>
          {intl.formatMessage({
            id: STATUS_MESSAGE[data.stage] ?? 'planRuns.status.materialized',
          })}
        </Badge>
      </div>

      {/* What was clustered */}
      <section className='flex flex-col gap-2'>
        <h2 className='text-sm font-medium text-muted-foreground'>
          {intl.formatMessage({ id: 'planRuns.clustersHeading' })}
        </h2>
        {clusters.length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            {intl.formatMessage({ id: 'planRuns.noClusters' })}
          </p>
        ) : (
          <ul className='flex flex-col gap-1'>
            {clusters.map((name, i) => (
              <li
                key={i}
                data-testid='archive-cluster'
                className='rounded-md border border-border bg-card px-3 py-2 text-sm'
              >
                {name}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Per-gate human-confirmed decisions */}
      <section className='flex flex-col gap-2'>
        <h2 className='text-sm font-medium text-muted-foreground'>
          {intl.formatMessage({ id: 'planRuns.gatesHeading' })}
        </h2>
        <ul className='flex flex-col gap-1'>
          {data.stageRecords.map(record => (
            <li
              key={record.kind}
              data-testid='archive-gate'
              className='flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm'
            >
              <span>
                {intl.formatMessage({ id: GATE_MESSAGE[record.kind] })}
              </span>
              <span className='text-xs text-muted-foreground'>
                {record.confirmedAt
                  ? intl.formatMessage(
                      { id: 'planRuns.gateConfirmed' },
                      {
                        date: intl.formatDate(new Date(record.confirmedAt), {
                          dateStyle: 'medium',
                        }),
                      }
                    )
                  : intl.formatMessage({ id: 'planRuns.gatePending' })}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Materialized Initiative(s) — lineage */}
      <section className='flex flex-col gap-2'>
        <h2 className='text-sm font-medium text-muted-foreground'>
          {intl.formatMessage({ id: 'planRuns.initiativesHeading' })}
        </h2>
        {data.initiatives.length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            {intl.formatMessage({ id: 'planRuns.noInitiatives' })}
          </p>
        ) : (
          <ul className='flex flex-col gap-1'>
            {data.initiatives.map(initiative => (
              <li key={initiative.id}>
                <Link
                  href={`/workspace/${workspaceUrl}/initiatives`}
                  data-testid='archive-initiative'
                  className='block rounded-md border border-border bg-card px-3 py-2 text-sm text-primary underline underline-offset-2 hover:no-underline'
                >
                  {initiative.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/**
 * The cluster labels a run settled on — the human-confirmed clustering if the
 * gate was confirmed, else the Stage-1 draft. Defensive: the stored output is
 * opaque JSON, so we only read `clusters[].name` when the shape matches.
 */
function clusterNames(record: PlanRunArchiveStage): string[] {
  const src = record.humanConfirmedOutput ?? record.llmRawOutput
  if (
    src &&
    typeof src === 'object' &&
    Array.isArray((src as { clusters?: unknown }).clusters)
  ) {
    return (src as { clusters: unknown[] }).clusters
      .map(c =>
        c &&
        typeof c === 'object' &&
        typeof (c as { name?: unknown }).name === 'string'
          ? (c as { name: string }).name
          : null
      )
      .filter((n): n is string => n !== null)
  }
  return []
}
