'use client'

import { useIntl } from 'react-intl'
import { BarChart2 } from 'lucide-react'
import { useProjectSummary } from '../../hooks/useSummary'
import { SummaryReportCard } from './SummaryReportCard'
import { StatsCardRow } from './StatsCardRow'
import { StatusDistributionChart } from './StatusDistributionChart'
import { MemberWorkloadChart } from './MemberWorkloadChart'
import { CompletionTrendChart } from './CompletionTrendChart'
import { AdditionalStats } from './AdditionalStats'
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
}

export function ProjectSummaryTab({ projectId }: ProjectSummaryTabProps) {
  const intl = useIntl()
  const { summary, history, loading, error, loadHistory, historyLoading } =
    useProjectSummary(projectId)

  if (loading && !summary) {
    return (
      <div className='flex items-center justify-center py-16'>
        <p className='text-sm text-zinc-400 dark:text-zinc-500'>
          {intl.formatMessage({
            id: 'common.loading',
            defaultMessage: 'Loading…',
          })}
        </p>
      </div>
    )
  }

  if (!summary) {
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
      <SummaryReportCard
        tldr={summary.tldr}
        report={summary.report}
        generatedAt={summary.generatedAt}
      />

      <StatsCardRow stats={summary.stats} />

      <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
        <StatusDistributionChart
          distribution={summary.stats.statusDistribution}
        />
        <MemberWorkloadChart workload={summary.stats.memberWorkload} />
        <CompletionTrendChart trend={summary.stats.completionTrend} />
      </div>

      <AdditionalStats stats={summary.stats} />

      <SummaryHistory
        history={history}
        loading={historyLoading}
        onLoad={loadHistory}
      />
    </div>
  )
}
