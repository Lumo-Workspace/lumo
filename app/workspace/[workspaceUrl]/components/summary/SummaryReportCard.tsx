'use client'

import { useState } from 'react'
import { Bot, ChevronDown, ChevronUp } from 'lucide-react'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'

interface SummaryReportCardProps {
  tldr: string
  report: string
  generatedAt: string
}

export function SummaryReportCard({
  tldr,
  report,
  generatedAt,
}: SummaryReportCardProps) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(false)

  const formattedDate = new Date(generatedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-4 space-y-3'>
      <div className='flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500'>
        <Bot size={14} />
        <span>
          {intl.formatMessage(
            { id: 'summary.generatedAt' },
            { date: formattedDate }
          )}
        </span>
      </div>

      <div>
        <p className='text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1'>
          {intl.formatMessage({ id: 'summary.tldr' })}
        </p>
        <p className='text-sm text-zinc-800 dark:text-zinc-200'>{tldr}</p>
      </div>

      <button
        onClick={() => setExpanded(prev => !prev)}
        className='flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors'
      >
        {expanded ? (
          <>
            <ChevronUp size={14} />
            {intl.formatMessage({ id: 'summary.hideReport' })}
          </>
        ) : (
          <>
            <ChevronDown size={14} />
            {intl.formatMessage({ id: 'summary.showReport' })}
          </>
        )}
      </button>

      {expanded && (
        <p
          className={cn(
            'text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap',
            'border-t border-zinc-200 dark:border-zinc-800 pt-3'
          )}
        >
          {report}
        </p>
      )}
    </div>
  )
}
