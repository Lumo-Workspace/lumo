'use client'

import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import { Activity } from 'lucide-react'
import { useNow } from '@/hooks/use-now'
import { buildSignalView } from '@/lib/summaries/signal-view'
import { useProjectRealtimeStats } from '../../hooks/useRealtimeStats'
import { useProjectLatestReport } from '../../hooks/useLatestReport'
import { useReportRefresh } from '../../hooks/useReportRefresh'
import { RefreshReportButton } from '../summary/RefreshReportButton'
import { SignalHeader } from './SignalHeader'
import { NeedsAttentionPanel } from './NeedsAttentionPanel'
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'

interface ProjectSignalTabProps {
  projectId: string
  onOpenTask?: (taskId: string) => void
}

export function ProjectSignalTab({
  projectId,
  onOpenTask,
}: ProjectSignalTabProps) {
  const intl = useIntl()
  const now = useNow()

  const {
    stats,
    loading: statsLoading,
    error: statsError,
  } = useProjectRealtimeStats(projectId)

  // The page no longer renders a prose headline — the cards are the statement.
  // The report is still fetched so Refresh has something to invalidate.
  const { loading: reportLoading, refetch: refetchReport } =
    useProjectLatestReport(projectId)

  const {
    state: refreshState,
    cooldownSeconds,
    trigger: triggerRefresh,
  } = useReportRefresh({ type: 'project', projectId }, refetchReport)

  const view = useMemo(() => (stats ? buildSignalView(stats) : null), [stats])

  if (statsLoading && reportLoading && !stats) {
    return (
      <div className='flex items-center justify-center py-16'>
        <p className='text-body text-muted-foreground'>
          {intl.formatMessage({ id: 'common.loading' })}
        </p>
      </div>
    )
  }

  if (!stats || !view) {
    return (
      <div className='px-4 py-6 md:px-8'>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Activity />
            </EmptyMedia>
            <EmptyTitle>
              {intl.formatMessage({ id: 'signal.title' })}
            </EmptyTitle>
            <EmptyDescription>
              {statsError
                ? intl.formatMessage({ id: 'summary.reportFailed' })
                : intl.formatMessage({ id: 'signal.noSignals' })}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent />
        </Empty>
      </div>
    )
  }

  const { topBlockers } = stats

  return (
    <div className='space-y-6 px-4 py-6 md:px-8'>
      <div className='flex justify-end'>
        <RefreshReportButton
          state={refreshState}
          cooldownSeconds={cooldownSeconds}
          onRefresh={triggerRefresh}
        />
      </div>

      <SignalHeader view={view} />

      <NeedsAttentionPanel
        highStakes={topBlockers.highStakesTaskIds}
        stalled={topBlockers.stalledTaskIds}
        stalePrs={topBlockers.staleOpenPrs}
        now={now}
        onOpenTask={onOpenTask ?? (() => {})}
      />
    </div>
  )
}
