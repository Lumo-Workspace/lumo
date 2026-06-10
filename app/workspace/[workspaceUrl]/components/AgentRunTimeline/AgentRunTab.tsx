'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Bot, ChevronRight } from 'lucide-react'
import { useAgentRuns } from '../../hooks/useAgentRuns'
import { AgentRunCard } from './AgentRunCard'
import { TokenCostBreakdown } from '../TokenCostBreakdown'
import { fmtCompact, modelLabel } from './model-cost-format'
import { IN_FLIGHT_MODEL } from '@/types/model-cost'

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
  // Collapsed by default (LUM-351) — the header row already carries per-model
  // totals, and live burn has its own delivery card in the sidebar.
  const [costOpen, setCostOpen] = useState(false)

  if (loading && !data) {
    return (
      <div className='py-8 text-center text-caption text-muted-foreground'>
        {intl.formatMessage({
          id: 'agentRun.loading',
          defaultMessage: '加载中…',
        })}
      </div>
    )
  }

  if (error) {
    return (
      <div className='py-8 text-center text-caption text-red-500'>{error}</div>
    )
  }

  const runs = data?.runs ?? []

  if (runs.length === 0) {
    return (
      <div className='py-12 flex flex-col items-center gap-2 text-muted-foreground'>
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

  const { totals } = data!
  const hasInFlight = totals.byModel.some(
    m => m.inFlight || m.model === IN_FLIGHT_MODEL
  )
  const modelSummary = totals.byModel
    .map(m => `${modelLabel(intl, m.model)} ${fmtCompact(intl, m.total)}`)
    .join(' · ')

  return (
    <div className='space-y-3'>
      {totals.byModel.length > 0 && (
        <div className='rounded-lg border border-border'>
          <button
            type='button'
            onClick={() => setCostOpen(v => !v)}
            aria-expanded={costOpen}
            data-testid='token-usage-toggle'
            className='flex w-full items-center gap-2 rounded-lg px-3 py-2 text-caption transition-colors hover:bg-muted/60'
          >
            <ChevronRight
              className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${costOpen ? 'rotate-90' : ''}`}
              aria-hidden
            />
            <span className='shrink-0 font-medium'>
              {intl.formatMessage({
                id: 'tokenCost.label',
                defaultMessage: 'Token usage',
              })}
            </span>
            <span className='shrink-0 text-muted-foreground'>
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
            </span>
            {!costOpen && (
              <span className='ml-auto flex min-w-0 items-center gap-2 text-muted-foreground'>
                {hasInFlight && (
                  <span
                    data-testid='collapsed-in-flight-dot'
                    className='size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/60'
                    aria-hidden
                  />
                )}
                <span className='truncate tabular-nums'>{modelSummary}</span>
              </span>
            )}
          </button>
          {costOpen && (
            <TokenCostBreakdown
              variant='full'
              showTitle={false}
              models={totals.byModel}
              loopCount={totals.loopCount}
              perMember={data?.perMember ?? []}
            />
          )}
        </div>
      )}
      {runs.map(run => (
        <AgentRunCard
          key={run.sessionId ?? `unlinked-${run.runNumber}`}
          run={run}
          defaultExpanded={false}
        />
      ))}
    </div>
  )
}
