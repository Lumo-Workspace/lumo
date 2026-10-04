'use client'

import { useIntl } from 'react-intl'

/** Open/merged PR indicator for a task-mention chip (LUM-411). `none` renders
 *  nothing upstream, so this only handles the two visible states. Color flows
 *  through the semantic feedback tokens (open → info, merged → success). */
export function PrBadge({ state }: { state: 'open' | 'merged' }) {
  const intl = useIntl()
  const label = intl.formatMessage({
    id: state === 'merged' ? 'mention.pr.merged' : 'mention.pr.open',
  })
  const colorClass = state === 'merged' ? 'text-success-text' : 'text-info'

  return (
    <span
      data-pr-state={state}
      className={`ml-0.5 inline-flex items-center align-middle ${colorClass}`}
      title={label}
      aria-label={label}
      contentEditable={false}
    >
      {/* Minimal git-pull-request glyph: two nodes joined by an arc. */}
      <svg width={12} height={12} viewBox='0 0 12 12' fill='none' aria-hidden>
        <circle cx='3' cy='3' r='1.4' stroke='currentColor' strokeWidth='1.2' />
        <circle cx='3' cy='9' r='1.4' stroke='currentColor' strokeWidth='1.2' />
        <path d='M3 4.4v3.2' stroke='currentColor' strokeWidth='1.2' />
        {state === 'merged' ? (
          // merged: second node fans into the first's lane
          <path
            d='M9 9V5.5A2.5 2.5 0 0 0 6.5 3H4.4'
            stroke='currentColor'
            strokeWidth='1.2'
            fill='none'
          />
        ) : (
          // open: parallel lane with an open arrow head
          <>
            <circle
              cx='9'
              cy='9'
              r='1.4'
              stroke='currentColor'
              strokeWidth='1.2'
            />
            <path
              d='M9 7.6V5A2 2 0 0 0 7 3H4.4'
              stroke='currentColor'
              strokeWidth='1.2'
              fill='none'
            />
          </>
        )}
      </svg>
    </span>
  )
}
