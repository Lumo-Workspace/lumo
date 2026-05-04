'use client'

import { useIntl } from 'react-intl'
import type { AgentRunHookEventItem } from '../../types'
import {
  CATEGORY_STYLE,
  categorizeHookEvent,
  pillLabel,
  summarizeEvent,
} from './categorize'

interface AgentRunEventRowProps {
  event: AgentRunHookEventItem
}

export function AgentRunEventRow({ event }: AgentRunEventRowProps) {
  const intl = useIntl()
  const category = categorizeHookEvent(event)
  const style = CATEGORY_STYLE[category]
  const summary = summarizeEvent(event)
  const label = pillLabel(event)

  const time = new Date(event.createdAt).toLocaleTimeString(intl.locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  return (
    <div className='flex items-start gap-3 py-1.5'>
      <span
        className={`mt-1.5 size-2 shrink-0 rounded-full ${style.dot}`}
        aria-hidden
      />
      <span className='shrink-0 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500 mt-0.5'>
        {time}
      </span>
      <span
        className={`shrink-0 px-1.5 py-px rounded text-[10px] font-medium uppercase tracking-wide ${style.pill}`}
      >
        {label}
      </span>
      <span className='min-w-0 flex-1 text-xs text-zinc-700 dark:text-zinc-300 break-all font-mono'>
        {summary}
      </span>
    </div>
  )
}
