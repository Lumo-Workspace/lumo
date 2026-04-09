'use client'

import { useIntl } from 'react-intl'
import { BarChart2 } from 'lucide-react'
import { useWorkspaceSummary } from '../../hooks/useSummary'
import { SummaryReportCard } from '../summary/SummaryReportCard'
import { StatsCardRow } from '../summary/StatsCardRow'
import { StatusDistributionChart } from '../summary/StatusDistributionChart'
import { MemberWorkloadChart } from '../summary/MemberWorkloadChart'
import { CompletionTrendChart } from '../summary/CompletionTrendChart'
import { AdditionalStats } from '../summary/AdditionalStats'
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
          <SummaryReportCard
            tldr={summary.tldr}
            report={summary.report}
            generatedAt={summary.generatedAt}
          />

          {stats && (
            <>
              <StatsCardRow stats={stats} />

              {projectBreakdown.length > 0 && (
                <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden'>
                  <div className='px-4 py-3 border-b border-zinc-100 dark:border-zinc-800'>
                    <p className='text-sm font-semibold text-zinc-800 dark:text-zinc-200'>
                      {intl.formatMessage({ id: 'summary.projectProgress' })}
                    </p>
                  </div>
                  <div className='divide-y divide-zinc-100 dark:divide-zinc-800'>
                    {projectBreakdown.map(pb => {
                      const pct =
                        pb.totalTasks > 0
                          ? Math.round(
                              (pb.completedTasks / pb.totalTasks) * 100
                            )
                          : 0
                      return (
                        <div
                          key={pb.projectId}
                          className='flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors'
                          onClick={() => onNavigateToProject(pb.projectId)}
                        >
                          <div className='flex-1 min-w-0'>
                            <p className='text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate'>
                              {pb.projectName}
                            </p>
                            <div className='mt-1.5 h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden'>
                              <div
                                className='h-full rounded-full bg-indigo-500'
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                          <div className='shrink-0 text-right text-xs text-zinc-500 dark:text-zinc-400 w-24'>
                            <span className='font-medium text-zinc-700 dark:text-zinc-300'>
                              {pb.completedTasks}/{pb.totalTasks}
                            </span>{' '}
                            {intl
                              .formatMessage({ id: 'summary.completed' })
                              .toLowerCase()}
                          </div>
                          {pb.overdueTasks > 0 && (
                            <div className='shrink-0 text-xs text-amber-500 font-medium w-20 text-right'>
                              {pb.overdueTasks}{' '}
                              {intl
                                .formatMessage({ id: 'summary.overdue' })
                                .toLowerCase()}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
                <StatusDistributionChart
                  distribution={stats.statusDistribution}
                />
                <MemberWorkloadChart workload={stats.memberWorkload} />
                <CompletionTrendChart trend={stats.completionTrend} />
              </div>

              <AdditionalStats stats={stats} />
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
