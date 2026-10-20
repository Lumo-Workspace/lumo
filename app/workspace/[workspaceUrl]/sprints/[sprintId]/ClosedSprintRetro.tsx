'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useRetrySprintSummary,
  useSprintSpillover,
  useSprintSummary,
} from '../../hooks/useSprints'
import { ApiClientError } from '@/lib/api-client'
import type { SprintAttentionResponse } from '@/lib/api-client/sprints'
import { OutcomeCards } from '../components/detail/OutcomeCards'
import { RetroCard } from '../components/detail/RetroCard'
import { CarriedOverCard } from '../components/detail/CarriedOverCard'
import { ProcessStagesCard } from '../components/detail/ProcessStagesCard'
import { SprintTaskTable } from '../components/detail/SprintTaskTable'
import { toTaskRows } from '../components/detail/view-model'
import {
  buildProcessStages,
  readRetroStats,
  toCarriedOver,
} from '../components/detail/retro-view-model'

interface ClosedSprintRetroProps {
  sprintId: string
  /** The team-scope attention read (LUM-1278); null while loading. */
  attention: Pick<SprintAttentionResponse, 'tasks' | 'cost'> | null
  attentionLoading: boolean
  /** The attention read failed — cost figures say so instead of "—". */
  attentionFailed: boolean
  onOpenTask: (taskId: string, identifier?: string) => void
}

/**
 * LUM-1281 — the closed-sprint retro layout: outcome cards, the generated
 * retro, carried-over tasks and the process-stages table. Reads the stored
 * summary (this sprint's and the previous sprint's) and maps it to flat
 * props; never derives a figure the server did not store (option A).
 */
export function ClosedSprintRetro({
  sprintId,
  attention,
  attentionLoading,
  attentionFailed,
  onOpenTask,
}: ClosedSprintRetroProps) {
  const intl = useIntl()
  const { summary, isLoading, error } = useSprintSummary(sprintId)
  // 404 = the retro is not generated yet; anything else is a failed read.
  const summaryReadFailed =
    !!error && !(error instanceof ApiClientError && error.status === 404)
  const statsStatus = summary
    ? 'ready'
    : summaryReadFailed
      ? 'failed'
      : 'pending'
  const { retry, retrying, retryError } = useRetrySprintSummary(sprintId)
  const previousRef = attention?.cost.previousSprint ?? null
  const previous = useSprintSummary(previousRef?.sprintId ?? null)
  const { spillover } = useSprintSpillover(sprintId)
  const [showTasks, setShowTasks] = useState(false)

  const stats = useMemo(() => readRetroStats(summary?.stats), [summary])
  const previousStats = useMemo(
    () => readRetroStats(previous.summary?.stats),
    [previous.summary]
  )
  const stages = useMemo(
    () =>
      buildProcessStages(
        stats?.processStages ?? null,
        previousRef
          ? {
              name: previousRef.name,
              stages: previousStats?.processStages ?? null,
            }
          : null
      ),
    [stats, previousStats, previousRef]
  )
  // A failed spillover read degrades to the stored count alone.
  const carried = useMemo(
    () => (spillover ? toCarriedOver(spillover) : null),
    [spillover]
  )
  const taskRows = useMemo(
    () => toTaskRows(attention?.tasks ?? [], []),
    [attention]
  )

  const cost = attention?.cost ?? null
  const previousTokens =
    previousRef && previousRef.tokensPerVerifiedTask !== null
      ? { name: previousRef.name, value: previousRef.tokensPerVerifiedTask }
      : null
  const previousVerified =
    previousRef && previousStats && previousStats.verifiedCount !== null
      ? {
          name: previousRef.name,
          count: previousStats.verifiedCount,
          total: previousStats.totalTasks,
        }
      : null

  return (
    <>
      {isLoading || attentionLoading || previous.isLoading ? (
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4'>
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className='h-32' />
          ))}
        </div>
      ) : (
        <OutcomeCards
          statsStatus={statsStatus}
          costFailed={attentionFailed}
          verifiedCount={stats?.verifiedCount ?? null}
          totalTasks={stats?.totalTasks ?? 0}
          previousVerified={previousVerified}
          carriedOver={stats?.spillover ?? null}
          carriedOverDestinations={carried?.destinations ?? null}
          tokensPerVerifiedTask={cost?.tokensPerVerifiedTask ?? null}
          previousTokensPerVerifiedTask={previousTokens}
          reworkShare={cost?.reworkShare ?? null}
        />
      )}

      <RetroCard
        loading={isLoading}
        readFailed={summaryReadFailed}
        retro={
          summary
            ? {
                tldr: summary.tldr ?? '',
                report: summary.report ?? '',
                generatedAt: String(summary.generatedAt),
              }
            : null
        }
        retrying={retrying}
        retryError={retryError?.message ?? null}
        onRetry={retry}
      />

      <section className='flex flex-wrap gap-4 sm:gap-6'>
        <CarriedOverCard
          count={stats?.spillover ?? null}
          rows={carried?.rows ?? null}
          readFailed={summaryReadFailed}
          onOpenTask={onOpenTask}
        />
        {isLoading ? (
          <Skeleton className='h-64 min-w-0 flex-[1_1_400px]' />
        ) : (
          <ProcessStagesCard
            model={stages}
            emptyReason={
              summary
                ? 'notRecorded'
                : summaryReadFailed
                  ? 'readFailed'
                  : 'noSummary'
            }
          />
        )}
      </section>

      {taskRows.length > 0 && (
        <div className='flex flex-col gap-3'>
          <Button
            variant='link'
            className='self-start px-0 text-muted-foreground'
            aria-expanded={showTasks}
            onClick={() => setShowTasks(v => !v)}
          >
            {intl.formatMessage(
              {
                id: showTasks
                  ? 'sprints.detail.retro.hideTasks'
                  : 'sprints.detail.retro.viewAllTasks',
              },
              { count: taskRows.length }
            )}
          </Button>
          {showTasks && (
            <SprintTaskTable rows={taskRows} onOpenTask={onOpenTask} />
          )}
        </div>
      )}
    </>
  )
}
