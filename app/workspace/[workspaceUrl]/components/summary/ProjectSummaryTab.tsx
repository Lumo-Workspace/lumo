'use client'

import { useIntl } from 'react-intl'
import { BarChart2 } from 'lucide-react'
import { useProjectSummary } from '../../hooks/useSummary'
import { BriefingCard } from './BriefingCard'
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

  const stats = summary.stats

  return (
    <div className='space-y-4 px-4 md:px-8 py-6'>
      <BriefingCard
        tldr={summary.tldr}
        report={summary.report}
        generatedAt={summary.generatedAt}
        risk={stats?.risk ?? null}
      />

      {stats?.topBlockers && (
        <TopBlockersList
          blockers={stats.topBlockers}
          onOpenTask={onOpenTask ?? (() => {})}
        />
      )}

      <StatsCardRow stats={stats} />

      <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
        <StatusDistributionChart distribution={stats.statusDistribution} />
        <MemberWorkloadChart workload={stats.memberWorkload} />
        <CompletionTrendChart trend={stats.completionTrend} />
      </div>

      <SummaryHistory
        history={history}
        loading={historyLoading}
        onLoad={loadHistory}
      />
    </div>
  )
}
