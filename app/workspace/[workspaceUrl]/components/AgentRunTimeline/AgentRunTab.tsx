'use client'

import { useIntl } from 'react-intl'
import { Bot } from 'lucide-react'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { AgentRunCard } from './AgentRunCard'
import { TokenCostBreakdown } from '../TokenCostBreakdown'

interface AgentRunTabProps {
  taskId: string
  taskIdentifier: string
  enabled: boolean
}

export function AgentRunTab({
  taskId,
  taskIdentifier,
  enabled,
}: AgentRunTabProps) {
  const intl = useIntl()
  const { data, loading, error } = useAgentRuns({ taskId, enabled })

  if (loading && !data) {
    return (
      <div className='py-8 text-center text-xs text-muted-foreground'>
        {intl.formatMessage({
          id: 'agentRun.loading',
          defaultMessage: '加载中…',
        })}
      </div>
    )
  }

  if (error) {
    return <div className='py-8 text-center text-xs text-red-500'>{error}</div>
  }

  const runs = data?.runs ?? []

  if (runs.length === 0) {
    return (
      <div className='py-12 flex flex-col items-center gap-2 text-muted-foreground'>
        <Bot className='size-6' />
        <p className='text-xs'>
          {intl.formatMessage({
            id: 'agentRun.empty',
            defaultMessage: '此任务还没有 Agent 运行记录',
          })}
        </p>
        <p className='text-[11px] text-muted-foreground max-w-xs text-center'>
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

  const { totals } = data!
  return (
    <div className='space-y-3'>
      {totals.byModel.length > 0 && (
        <div className='rounded-lg border border-border'>
          <div className='px-3 py-2 border-b border-border text-xs text-muted-foreground'>
            {intl.formatMessage(
              {
                id: 'agentRun.summary',
                defaultMessage:
                  '{runs, plural, one {# run} other {# runs}} · {turns, plural, one {# turn} other {# turns}} · {models, plural, one {# model} other {# models}}',
              },
              {
                runs: totals.runCount,
                turns: totals.turnCount,
                models: totals.byModel.length,
              }
            )}
          </div>
          <TokenCostBreakdown
            variant='full'
            models={totals.byModel}
            loopCount={totals.loopCount}
          />
        </div>
      )}
      {runs.map((run, i) => (
        <AgentRunCard
          key={run.sessionId ?? `unlinked-${run.runNumber}`}
          run={run}
          defaultExpanded={i === 0}
        />
      ))}
    </div>
  )
}
