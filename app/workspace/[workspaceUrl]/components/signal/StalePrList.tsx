'use client'

import { useIntl } from 'react-intl'
import { ArrowUpRight, GitPullRequest } from 'lucide-react'
import { idleDays } from '@/lib/summaries/signal-view'
import type { StalePrItem } from '@/types/summary'

interface StalePrListProps {
  prs: StalePrItem[]
  /** ms epoch from `useNow()`, or null before mount. */
  now: number | null
}

/**
 * Stale open PRs, shown when that pill is expanded.
 *
 * The stats endpoint carries only number / openedAt / url per PR — no title,
 * branch or reviewer — so each row stays deliberately thin rather than
 * inventing detail the API cannot back.
 */
export function StalePrList({ prs, now }: StalePrListProps) {
  const intl = useIntl()

  return (
    <div
      data-testid='signal-panel-stalePrs'
      className='overflow-hidden rounded-lg border border-border'
    >
      <div className='border-b border-border bg-muted px-4 py-2 text-caption uppercase tracking-wider text-muted-foreground'>
        {intl.formatMessage(
          { id: 'signal.panel.stalePrs' },
          { count: prs.length }
        )}
      </div>
      {prs.map(pr => {
        const days = now === null ? null : idleDays(pr.openedAt, now)
        return (
          <a
            key={pr.number}
            href={pr.url}
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center gap-2.5 border-b border-border px-4 py-2.5 last:border-b-0 transition-colors hover:bg-muted'
          >
            <GitPullRequest
              className='size-3.5 text-warning-text'
              aria-hidden
            />
            <span className='text-body-strong font-mono text-foreground'>
              #{pr.number}
            </span>
            <span className='text-caption text-muted-foreground'>
              {days === null
                ? '—'
                : intl.formatMessage({ id: 'signal.prInReview' }, { d: days })}
            </span>
            <ArrowUpRight
              className='ml-auto size-3.5 text-muted-foreground'
              aria-hidden
            />
          </a>
        )
      })}
    </div>
  )
}
