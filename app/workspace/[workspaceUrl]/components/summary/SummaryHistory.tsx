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
            <p className='text-xs text-muted-foreground py-2'>
              {intl.formatMessage({
                id: 'common.loading',
                defaultMessage: 'Loading…',
              })}
            </p>
          )}

          {!loading && history.length === 0 && (
            <p className='text-xs text-muted-foreground py-2'>
              No history available.
            </p>
          )}

          {history.map(entry => {
            const isExpanded = expandedId === entry.id
            const formattedDate = new Date(
              entry.generatedAt
            ).toLocaleDateString(intl.locale, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })

            return (
              <div
                key={entry.id}
                className='border border-border rounded-lg overflow-hidden'
              >
                <button
                  onClick={() => handleToggleEntry(entry.id)}
                  className='w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted transition-colors'
                >
                  <div className='flex flex-col items-center gap-1 shrink-0 mt-0.5'>
                    <span className='size-2 rounded-full bg-muted-foreground' />
                    <span className='w-px flex-1 bg-border' />
                  </div>
                  <div className='flex-1 min-w-0 space-y-1'>
                    <p className='text-xs text-muted-foreground'>
                      {formattedDate}
                    </p>
                    <p className='text-sm text-foreground line-clamp-2'>
                      {entry.tldr}
                    </p>
                  </div>
                </button>

                {isExpanded && (
                  <div className='border-t border-border px-4 py-3'>
                    <p className='text-sm text-foreground whitespace-pre-wrap'>
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
