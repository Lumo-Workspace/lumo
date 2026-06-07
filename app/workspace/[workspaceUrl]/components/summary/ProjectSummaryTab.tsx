'use client'

import { useEffect } from 'react'
import { useIntl } from 'react-intl'
import { BarChart2 } from 'lucide-react'
import { useProjectRealtimeStats } from '../../hooks/useRealtimeStats'
import { useProjectLatestReport } from '../../hooks/useLatestReport'
import { useReportRefresh } from '../../hooks/useReportRefresh'
import { useProjectSummary } from '../../hooks/useSummary'
import { useMembers } from '../../hooks/useMembers'
import { BriefingCard } from './BriefingCard'
import { RefreshReportButton } from './RefreshReportButton'
import { TopBlockersList } from './TopBlockersList'
import { StatsCardRow } from './StatsCardRow'
import { StatusDistributionChart } from './StatusDistributionChart'
import { MemberWorkloadChart } from './MemberWorkloadChart'
import { CompletionTrendChart } from './CompletionTrendChart'
import { SummaryHistory } from './SummaryHistory'
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'

interface ProjectSummaryTabProps {
  projectId: string
  onOpenTask?: (taskId: string) => void
}

export function ProjectSummaryTab({
  projectId,
  onOpenTask,
}: ProjectSummaryTabProps) {
  const intl = useIntl()
  const {
    stats,
    loading: statsLoading,
    error: statsError,
  } = useProjectRealtimeStats(projectId)

  const {
    tldr,
    report,
    generatedAt,
    loading: reportLoading,
    refetch: refetchReport,
  } = useProjectLatestReport(projectId)

  const {
    state: refreshState,
    cooldownSeconds,
    trigger: triggerRefresh,
  } = useReportRefresh({ type: 'project', projectId }, refetchReport)

  const { history, loadHistory, historyLoading } = useProjectSummary(projectId)
  const { members, agentActors, fetchMembers } = useMembers()
  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  const loading = statsLoading && reportLoading
  const error = statsError

  if (loading && !stats && !tldr) {
    return (
      <div className='flex items-center justify-center py-16'>
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage({
            id: 'common.loading',
            defaultMessage: 'Loading…',
          })}
        </p>
      </div>
    )
  }

  if (!stats && !tldr) {
    return (
      <div className='space-y-4 px-4 md:px-8 py-6'>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <BarChart2 />
            </EmptyMedia>
            <EmptyTitle>
              {intl.formatMessage({ id: 'summary.title' })}
            </EmptyTitle>
            <EmptyDescription>
              {error
                ? intl.formatMessage({ id: 'summary.reportFailed' })
                : intl.formatMessage({ id: 'summary.noSummary' })}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent />
        </Empty>
      </div>
    )
  }

  return (
    <div className='space-y-4 px-4 md:px-8 py-6'>
      <div className='space-y-0'>
        <div className='flex justify-end mb-1'>
          <RefreshReportButton
            state={refreshState}
            cooldownSeconds={cooldownSeconds}
            onRefresh={triggerRefresh}
          />
        </div>
        <BriefingCard
          tldr={tldr ?? ''}
          report={report ?? ''}
          generatedAt={generatedAt ?? ''}
          risk={stats?.risk ?? null}
          members={members}
          agentActors={agentActors}
        />
      </div>

      {stats?.topBlockers && (
        <TopBlockersList
          blockers={stats.topBlockers}
          onOpenTask={onOpenTask ?? (() => {})}
        />
      )}

      {stats && (
        <>
          <StatsCardRow stats={stats} />

          <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
            <StatusDistributionChart distribution={stats.statusDistribution} />
            <MemberWorkloadChart workload={stats.memberWorkload} />
            <CompletionTrendChart trend={stats.completionTrend} />
          </div>
        </>
      )}

      <SummaryHistory
        history={history}
        loading={historyLoading}
        onLoad={loadHistory}
      />
    </div>
  )
}
