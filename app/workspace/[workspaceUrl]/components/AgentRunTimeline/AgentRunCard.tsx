'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronDown, ChevronRight, Bot } from 'lucide-react'
import type { AgentRunSession } from '../../types'
import { segmentIntoTurns } from './segment-turns'
import { TurnCard } from './TurnCard'

interface AgentRunCardProps {
  run: AgentRunSession
  defaultExpanded?: boolean
}

export function AgentRunCard({
  run,
  defaultExpanded = true,
}: AgentRunCardProps) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(defaultExpanded)

  const durationLabel = formatDuration(run.durationMs)
  const startLabel = new Date(run.startedAt).toLocaleString(intl.locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return (
    <div className='border border-zinc-200 dark:border-zinc-800 rounded-lg bg-white dark:bg-zinc-950'>
      <button
        type='button'
        onClick={() => setExpanded(v => !v)}
        className='w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900/60 transition-colors rounded-lg'
      >
        {expanded ? (
          <ChevronDown className='size-4 text-zinc-400 shrink-0' />
        ) : (
          <ChevronRight className='size-4 text-zinc-400 shrink-0' />
        )}
        <span className='flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-xs font-semibold shrink-0'>
          <Bot className='size-3' />
          {intl.formatMessage(
            { id: 'agentRun.runNumber', defaultMessage: 'Run #{n}' },
            { n: run.runNumber }
          )}
        </span>
        <span className='text-xs text-zinc-500 dark:text-zinc-400 shrink-0'>
          {startLabel}
        </span>
        <span className='ml-auto flex items-center gap-3 text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0'>
          <span>{durationLabel}</span>
          <span>·</span>
          <span>
            {intl.formatMessage(
              {
                id: 'agentRun.toolCalls',
                defaultMessage: '{n, plural, one {# tool} other {# tools}}',
              },
              { n: run.toolCallCount }
            )}
          </span>
          {run.memoryCount > 0 && (
            <>
              <span>·</span>
              <span className='text-violet-500 dark:text-violet-400'>
                {intl.formatMessage(
                  {
                    id: 'agentRun.memoryCount',
                    defaultMessage:
                      '+{n, plural, one {# memory} other {# memories}}',
                  },
                  { n: run.memoryCount }
                )}
              </span>
            </>
          )}
        </span>
      </button>

      {expanded && (
        <div className='border-t border-zinc-100 dark:border-zinc-800/80 px-4 py-2'>
          {run.items.length === 0 ? (
            <p className='py-3 text-xs text-zinc-400 italic'>
              {intl.formatMessage({
                id: 'agentRun.noEvents',
                defaultMessage: '本次运行没有捕获到事件',
              })}
            </p>
          ) : (
            <div>
              {segmentIntoTurns(run.items).map((turn, i) => (
                <TurnCard key={`turn-${i}`} turn={turn} turnNumber={i + 1} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  return rem === 0 ? `${min}m` : `${min}m ${rem}s`
}
