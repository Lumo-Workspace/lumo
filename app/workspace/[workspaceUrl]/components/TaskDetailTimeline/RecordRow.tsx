'use client'

import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

/**
 * LUM-1009 · one row of the Record tab's ④ Records list: a title, a one-line
 * summary readable while collapsed, and its body one click away. The only fold
 * level in Records. Expansion is parent-controlled so a deep link can open it.
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
  summary?: string
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
        className='flex w-full flex-wrap items-center gap-x-2.5 gap-y-0.5 px-4 py-3 text-left transition-colors hover:bg-muted/40'
      >
        <ChevronRight
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <span className='text-body-strong text-foreground'>{title}</span>
        {/* The summary stands in for the body while collapsed; open, the body
            says it in full. */}
        {summary && !expanded ? (
          <span className='ml-auto text-caption text-muted-foreground'>
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
