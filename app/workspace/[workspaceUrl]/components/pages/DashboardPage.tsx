'use client'

import { useIntl } from 'react-intl'
import { BarChart2 } from 'lucide-react'
import { useWorkspaceRealtimeStats } from '../../hooks/useRealtimeStats'
import { useWorkspaceLatestReport } from '../../hooks/useLatestReport'
import { useReportRefresh } from '../../hooks/useReportRefresh'
import { useWorkspaceSummary } from '../../hooks/useSummary'
import { useMembers } from '../../hooks/useMembers'
import { BriefingCard } from '../summary/BriefingCard'
import { RefreshReportButton } from '../summary/RefreshReportButton'
import { ProjectsAtGlanceList } from '../summary/ProjectsAtGlanceList'
import { StatsCardRow } from '../summary/StatsCardRow'
import { StatusDistributionChart } from '../summary/StatusDistributionChart'
import { MemberWorkloadChart } from '../summary/MemberWorkloadChart'
import { CompletionTrendChart } from '../summary/CompletionTrendChart'
import { SummaryHistory } from '../summary/SummaryHistory'
import { SpotCheckCard } from '../summary/SpotCheckCard'
import { useRunReviewPool } from '../../hooks/useRunReviewPool'
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import { PageBreadcrumb } from '../PageBreadcrumb'

interface DashboardPageProps {
  onNavigateToProject: (projectId: string) => void
  /** LUM-819 返工：抽查页的入口在这里，不在侧边栏。 */
  onOpenRunReviews: () => void
}

export function DashboardPage({
  onNavigateToProject,
  onOpenRunReviews,
}: DashboardPageProps) {
  const intl = useIntl()
  const { pool: reviewPool } = useRunReviewPool()
  const {
    stats,
    loading: statsLoading,
    error: statsError,
  } = useWorkspaceRealtimeStats()

  const {
    tldr,
    report,
    generatedAt,
    loading: reportLoading,
    refetch: refetchReport,
  } = useWorkspaceLatestReport()

  const {
    state: refreshState,
    cooldownSeconds,
    trigger: triggerRefresh,
  } = useReportRefresh({ type: 'workspace' }, refetchReport)

  const { history, loadHistory, historyLoading } = useWorkspaceSummary()
  const { members, agentActors } = useMembers()

  const loading = statsLoading && reportLoading
  const error = statsError

  if (loading && !stats && !tldr) {
    return (
      <div className='flex-1 flex flex-col overflow-hidden'>
        <PageBreadcrumb
          title={intl.formatMessage({ id: 'summary.dashboard' })}
        />
        <div className='flex items-center justify-center py-16'>
          <p className='text-sm text-muted-foreground'>
            {intl.formatMessage({
              id: 'common.loading',
              defaultMessage: 'Loading…',
            })}
          </p>
        </div>
      </div>
    )
  }

  if (!stats && !tldr) {
    return (
      <div className='flex-1 flex flex-col overflow-hidden'>
        <PageBreadcrumb
          title={intl.formatMessage({ id: 'summary.dashboard' })}
        />
        <div className='flex-1 overflow-y-auto'>
          <div className='px-4 md:px-8 py-6 space-y-4'>
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
        </div>
      </div>
    )
  }

  const projectBreakdown = stats?.projectBreakdown ?? []

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      <PageBreadcrumb title={intl.formatMessage({ id: 'summary.dashboard' })} />
      <div className='flex-1 overflow-y-auto'>
        <div className='px-4 md:px-8 py-6 space-y-4'>
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
              members={members}
              agentActors={agentActors}
            />
          </div>

          <ProjectsAtGlanceList
            projects={projectBreakdown}
            onNavigate={onNavigateToProject}
          />

          {reviewPool && (
            <SpotCheckCard
              rate={reviewPool.rate}
              poolSize={reviewPool.poolSize}
              onOpen={onOpenRunReviews}
            />
          )}

          {stats && (
            <>
              <StatsCardRow stats={stats} />

              <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
                <StatusDistributionChart
                  distribution={stats.statusDistribution}
                />
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
      </div>
    </div>
  )
}
