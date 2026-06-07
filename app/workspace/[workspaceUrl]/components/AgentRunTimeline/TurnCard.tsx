'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronDown, ChevronRight, ArrowUp, MoonStar } from 'lucide-react'
import type { Turn } from './segment-turns'
import { InlineMemoryCard } from './InlineMemoryCard'
import { AgentRunEventRow } from './AgentRunEventRow'

interface TurnCardProps {
  turn: Turn
  /** 1-based index, used for the "Turn #N" label and as a stable key. */
  turnNumber: number
}

export function TurnCard({ turn, turnNumber }: TurnCardProps) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(false)

  const hasMemory = turn.memories.length > 0
  const eventCount = turn.events.length

  const timeRange = formatRange(turn.startTime, turn.endTime, intl.locale)

  return (
    <div className='my-3'>
      {/* Header — different visual weight for sedimented vs silent turns */}
      <div className='flex items-center gap-2 mb-2 px-1'>
        <span
          className={
            hasMemory
              ? 'text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300'
              : 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground'
          }
        >
          {intl.formatMessage(
            { id: 'agentRun.turnNumber', defaultMessage: 'Turn {n}' },
            { n: turnNumber }
          )}
        </span>
        <span className='text-[11px] tabular-nums text-muted-foreground'>
          {timeRange}
        </span>
        {!turn.terminated && (
          <span className='text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 px-1.5 py-px rounded-sm bg-amber-50 dark:bg-amber-950/40'>
            {intl.formatMessage({
              id: 'agentRun.unterminatedTurn',
              defaultMessage: '未终止',
            })}
          </span>
        )}
      </div>

      {/* Summary line — Claude's own "what I just did" message,
          condensed to a one-line headline. Full text stays visible in
          the expanded STOP event row. */}
      {turn.summary && (
        <p className='mb-2 px-1 text-sm text-foreground truncate'>
          {turn.summary}
        </p>
      )}

      {/* Body — memories or silent placeholder */}
      {hasMemory ? (
        <div className='space-y-2'>
          {turn.memories.map(m => (
            <InlineMemoryCard key={m.id} item={m} />
          ))}
        </div>
      ) : (
        <div className='flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/60 px-4 py-2'>
          <MoonStar className='size-3.5 text-muted-foreground shrink-0' />
          <span className='text-xs text-muted-foreground'>
            {turn.summary
              ? intl.formatMessage({
                  id: 'agentRun.silentTurnWithSummary',
                  defaultMessage: '本回合未沉淀新记忆',
                })
              : intl.formatMessage({
                  id: 'agentRun.silentTurn',
                  defaultMessage: '静默回合 — 本回合未沉淀记忆',
                })}
          </span>
        </div>
      )}

      {/* Provenance / events disclosure */}
      {eventCount > 0 && (
        <div className='mt-2 ml-1'>
          <button
            type='button'
            onClick={() => setExpanded(v => !v)}
            className={
              hasMemory
                ? 'flex items-center gap-1 text-[11px] text-violet-600 dark:text-violet-400 hover:text-violet-800 dark:hover:text-violet-200 transition-colors'
                : 'flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors'
            }
          >
            {expanded ? (
              <ChevronDown className='size-3' />
            ) : (
              <ChevronRight className='size-3' />
            )}
            {hasMemory && <ArrowUp className='size-3' />}
            <span>
              {hasMemory
                ? intl.formatMessage(
                    {
                      id: 'agentRun.memoryProvenance',
                      defaultMessage:
                        '由本回合 {n, plural, one {# 个事件} other {# 个事件}}提炼',
                    },
                    { n: eventCount }
                  )
                : intl.formatMessage(
                    {
                      id: 'agentRun.silentTurnEvents',
                      defaultMessage:
                        '本回合 {n, plural, one {# 个事件} other {# 个事件}}',
                    },
                    { n: eventCount }
                  )}
            </span>
            <span className='ml-1 opacity-70'>
              {expanded
                ? intl.formatMessage({
                    id: 'agentRun.collapseEvents',
                    defaultMessage: '收起',
                  })
                : intl.formatMessage({
                    id: 'agentRun.expandEvents',
                    defaultMessage: '展开查看',
                  })}
            </span>
          </button>
          {expanded && (
            <div
              className={
                hasMemory
                  ? 'mt-2 ml-4 pl-3 border-l-2 border-violet-200 dark:border-violet-900/60'
                  : 'mt-2 ml-4 pl-3 border-l-2 border-border'
              }
            >
              {turn.events.map(ev => (
                <AgentRunEventRow key={ev.id} event={ev} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatRange(startIso: string, endIso: string, locale: string): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const opts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }
  const startStr = start.toLocaleTimeString(locale, opts)
  const endStr = end.toLocaleTimeString(locale, opts)
  if (startStr === endStr) return startStr
  return `${startStr} → ${endStr}`
}
