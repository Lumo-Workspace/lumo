'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useIntl } from 'react-intl'
import { formatTimestamp } from '@/lib/utils/formatTimestamp'
import type { SessionListRow } from '@/lib/services/session-list.service'
import { SESSION_MESSAGES as M } from './messages'

interface SessionsListProps {
  rows: SessionListRow[]
}

/** Relative label computed after mount so render stays pure (no clock read). */
function LastActivity({ iso, locale }: { iso: string; locale: string }) {
  const [label, setLabel] = useState('')
  useEffect(() => setLabel(formatTimestamp(iso, locale)), [iso, locale])
  return <div suppressHydrationWarning>{label}</div>
}

export function SessionsList({ rows }: SessionsListProps) {
  const intl = useIntl()

  return (
    <div className='mx-auto max-w-4xl px-6 py-10'>
      <header className='mb-6 flex items-baseline justify-between'>
        <h1 className='text-2xl font-semibold'>
          {intl.formatMessage(M['list.title'])}
        </h1>
        <span className='text-sm text-muted-foreground'>
          {intl.formatMessage(M['list.recent'], { count: rows.length })}
        </span>
      </header>

      {rows.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {intl.formatMessage(M['list.empty'])}
        </p>
      ) : (
        <ul className='divide-y divide-border rounded-md border'>
          {rows.map(s => (
            <li key={s.id}>
              <Link
                href={`/sessions/${s.id}`}
                className='flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/40'
              >
                <div className='min-w-0 flex-1'>
                  <div className='truncate font-mono text-xs text-muted-foreground'>
                    {s.id}
                  </div>
                  <div className='truncate text-sm'>
                    {s.cwd ?? (
                      <span className='italic'>
                        {intl.formatMessage(M['list.noCwd'])}
                      </span>
                    )}
                  </div>
                  {(s.subagentCount > 0 || s.taskCount > 0) && (
                    <div className='truncate text-xs text-muted-foreground'>
                      {intl.formatMessage(M['list.familySummary'], {
                        subagents: s.subagentCount,
                        tasks: s.taskCount,
                      })}
                    </div>
                  )}
                </div>
                <div className='shrink-0 text-right text-xs text-muted-foreground'>
                  <LastActivity iso={s.lastActivityAt} locale={intl.locale} />
                  <div>
                    {intl.formatMessage(M['list.events'], {
                      count: s.eventCount,
                    })}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
