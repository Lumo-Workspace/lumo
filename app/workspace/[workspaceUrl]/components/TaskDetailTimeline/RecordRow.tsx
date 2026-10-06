'use client'

import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

/**
 * LUM-1009 · one row of the Record tab's Records list: a title, a one-line
 * verdict, and its body one click away. The only fold level in Records.
 * Expansion is parent-controlled so a deep link can open it.
 *
 * LUM-1012: the verdict sits right after the title and stays put when the row
 * opens — every row reads "name · verdict" the same way.
 */
export function RecordRow({
  id,
  title,
  summary,
  expanded,
  onToggle,
  children,
}: {
  /** DOM id — the deep-link / scroll target for this row. */
  id: string
  title: string
  summary?: ReactNode
  expanded: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div id={id} className='overflow-hidden rounded-lg border border-border'>
      <button
        type='button'
        aria-expanded={expanded}
        onClick={onToggle}
        className='grid w-full grid-cols-[0.875rem_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 px-4 py-3 text-left transition-colors hover:bg-muted/40 sm:grid-cols-[0.875rem_11rem_minmax(0,1fr)]'
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <span className='text-body-strong text-foreground'>{title}</span>
        {summary ? (
          <span
            data-testid='record-row-summary'
            className='col-start-2 text-body text-muted-foreground sm:col-start-3'
          >
            {summary}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className='border-t border-border px-4 py-3'>{children}</div>
      ) : null}
    </div>
  )
}
