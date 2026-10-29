'use client'

import { useIntl } from 'react-intl'
import { Bot } from 'lucide-react'
import type { AgentRunTimelineResponse } from '../../types'
import { TokenUsageBreakdown } from './TokenUsageBreakdown'
import { LoadingState } from '../AsyncContent'
import { RowListSkeleton } from '../skeletons/RowListSkeleton'

interface TokenUsageSectionProps {
  data: AgentRunTimelineResponse | null | undefined
  loading: boolean
  error: string | null
  taskIdentifier: string
}

/** The token-usage body of the delivery card: loading / error / empty / the
 *  collapsible breakdown. Returns null when runs exist but captured no usage —
 *  the parent then omits the divider entirely. */
export function TokenUsageSection({
  data,
  loading,
  error,
  taskIdentifier,
}: TokenUsageSectionProps) {
  const intl = useIntl()

  if (loading && !data) {
    return (
      <LoadingState
        className='py-2'
        label={intl.formatMessage({ id: 'agentRun.loading' })}
      >
        <RowListSkeleton
          rows={2}
          leading='icon'
          subtitle
          rowClassName='rounded-lg border border-border px-4 py-3'
          className='space-y-2'
        />
      </LoadingState>
    )
  }
  if (error) {
    return (
      <div className='py-6 text-center text-caption text-danger-text'>
        {error}
      </div>
    )
  }

  const runs = data?.runs ?? []
  if (runs.length === 0) {
    return (
      <div className='py-8 flex flex-col items-center gap-2 text-muted-foreground'>
        <Bot className='size-6' />
        <p className='text-caption'>
          {intl.formatMessage({
            id: 'agentRun.empty',
            defaultMessage: '此任务还没有 Agent 运行记录',
          })}
        </p>
        <p className='text-caption text-muted-foreground max-w-xs text-center'>
          {intl.formatMessage(
            {
              id: 'agentRun.emptyHint',
              defaultMessage:
                '运行 /lumo {identifier} 绑定此任务，Agent 运行过程会自动同步到这里',
            },
            { identifier: taskIdentifier }
          )}
        </p>
      </div>
    )
  }

  const totals = data!.totals
  if (totals.byModel.length === 0) return null

  return <TokenUsageBreakdown totals={totals} perMember={data!.perMember} />
}
