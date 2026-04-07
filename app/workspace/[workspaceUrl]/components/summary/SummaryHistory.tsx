'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import type { ApiProjectSummary, ApiWorkspaceSummary } from '@/types/summary'

type SummaryEntry = ApiProjectSummary | ApiWorkspaceSummary

interface SummaryHistoryProps {
  history: SummaryEntry[]
  loading: boolean
  onLoad: () => void
}

export function SummaryHistory({
  history,
  loading,
  onLoad,
}: SummaryHistoryProps) {
  const intl = useIntl()
  const [revealed, setRevealed] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const handleViewHistory = () => {
    if (!revealed) {
      setRevealed(true)
      onLoad()
    } else {
      setRevealed(false)
      setExpandedId(null)
    }
  }

  const handleToggleEntry = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id))
  }

  return (
    <div className='space-y-2'>
      <button
        onClick={handleViewHistory}
        className='text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 transition-colors'
      >
        {intl.formatMessage({ id: 'summary.viewHistory' })} &rarr;
      </button>

      {revealed && (
        <div className='space-y-1'>
          {loading && (
            <p className='text-xs text-zinc-400 dark:text-zinc-500 py-2'>
              Loading&hellip;
            </p>
          )}

          {!loading && history.length === 0 && (
            <p className='text-xs text-zinc-400 dark:text-zinc-500 py-2'>
              No history available.
            </p>
          )}

          {history.map(entry => {
            const isExpanded = expandedId === entry.id
            const formattedDate = new Date(
              entry.generatedAt
            ).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })

            return (
              <div
                key={entry.id}
                className='border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden'
              >
                <button
                  onClick={() => handleToggleEntry(entry.id)}
                  className='w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors'
                >
                  <div className='flex flex-col items-center gap-1 shrink-0 mt-0.5'>
                    <span className='size-2 rounded-full bg-zinc-300 dark:bg-zinc-600' />
                    <span className='w-px flex-1 bg-zinc-200 dark:bg-zinc-700' />
                  </div>
                  <div className='flex-1 min-w-0 space-y-1'>
                    <p className='text-xs text-zinc-400 dark:text-zinc-500'>
                      {formattedDate}
                    </p>
                    <p className='text-sm text-zinc-700 dark:text-zinc-300 line-clamp-2'>
                      {entry.tldr}
                    </p>
                  </div>
                </button>

                {isExpanded && (
                  <div className='border-t border-zinc-200 dark:border-zinc-800 px-4 py-3'>
                    <p className='text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap'>
                      {entry.report}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
