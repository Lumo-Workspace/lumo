'use client'

import { useIntl } from 'react-intl'
import { BarChart2 } from 'lucide-react'
import { useWorkspaceSummary } from '../../hooks/useSummary'
import { BriefingCard } from '../summary/BriefingCard'
import { ProjectsAtGlanceList } from '../summary/ProjectsAtGlanceList'
import { StatsCardRow } from '../summary/StatsCardRow'
import { StatusDistributionChart } from '../summary/StatusDistributionChart'
import { MemberWorkloadChart } from '../summary/MemberWorkloadChart'
import { CompletionTrendChart } from '../summary/CompletionTrendChart'
import { SummaryHistory } from '../summary/SummaryHistory'
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
}

export function DashboardPage({ onNavigateToProject }: DashboardPageProps) {
  const intl = useIntl()
  const { summary, history, loading, error, loadHistory, historyLoading } =
    useWorkspaceSummary()

  if (loading && !summary) {
    return (
      <div className='flex-1 flex flex-col overflow-hidden'>
        <PageBreadcrumb
          title={intl.formatMessage({ id: 'summary.dashboard' })}
        />
        <div className='flex items-center justify-center py-16'>
          <p className='text-sm text-zinc-400 dark:text-zinc-500'>
            {intl.formatMessage({
              id: 'common.loading',
              defaultMessage: 'Loading…',
            })}
          </p>
        </div>
      </div>
    )
  }

  if (!summary) {
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

  const stats = summary.stats
  const projectBreakdown = stats?.projectBreakdown ?? []

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      <PageBreadcrumb title={intl.formatMessage({ id: 'summary.dashboard' })} />
      <div className='flex-1 overflow-y-auto'>
        <div className='px-4 md:px-8 py-6 space-y-4'>
          <BriefingCard
            tldr={summary.tldr}
            report={summary.report}
            generatedAt={summary.generatedAt}
            risk={stats?.risk ?? null}
          />

          <ProjectsAtGlanceList
            projects={projectBreakdown}
            onNavigate={onNavigateToProject}
          />

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
