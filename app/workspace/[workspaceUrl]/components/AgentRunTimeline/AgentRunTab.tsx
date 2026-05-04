'use client'

import { useIntl } from 'react-intl'
import { Bot } from 'lucide-react'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { AgentRunCard } from './AgentRunCard'

interface AgentRunTabProps {
  taskId: string
  enabled: boolean
}

export function AgentRunTab({ taskId, enabled }: AgentRunTabProps) {
  const intl = useIntl()
  const { data, loading, error } = useAgentRuns({ taskId, enabled })

  if (loading && !data) {
    return (
      <div className='py-8 text-center text-xs text-zinc-400'>
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
      <div className='py-12 flex flex-col items-center gap-2 text-zinc-400 dark:text-zinc-500'>
        <Bot className='size-6' />
        <p className='text-xs'>
          {intl.formatMessage({
            id: 'agentRun.empty',
            defaultMessage: '此任务还没有 Claude Code 运行记录',
          })}
        </p>
        <p className='text-[11px] text-zinc-300 dark:text-zinc-600 max-w-xs text-center'>
          {intl.formatMessage({
            id: 'agentRun.emptyHint',
            defaultMessage:
              '在终端运行 lumo task start，让 Claude Code 把执行过程同步到这里',
          })}
        </p>
      </div>
    )
  }

  return (
    <div className='space-y-3'>
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
