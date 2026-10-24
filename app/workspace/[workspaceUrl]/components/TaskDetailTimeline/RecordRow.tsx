'use client'

import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

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
  actions,
  expanded,
  onToggle,
  children,
}: {
  /** DOM id — the deep-link / scroll target for this row. */
  id: string
  title: string
  summary?: ReactNode
  /** Controls drawn at the header's end, outside the fold trigger. */
  actions?: ReactNode
  expanded: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <Collapsible
      open={expanded}
      onOpenChange={onToggle}
      id={id}
      className='overflow-hidden rounded-lg border border-border'
    >
      <div className='flex items-start transition-colors hover:bg-muted/40'>
        <CollapsibleTrigger className='grid min-w-0 flex-1 grid-cols-[0.875rem_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 px-4 py-3 text-left sm:grid-cols-[0.875rem_11rem_minmax(0,1fr)]'>
          <ChevronRight
            className='size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-90'
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
        </CollapsibleTrigger>
        {actions ? (
          <div className='flex shrink-0 items-center gap-2 py-2.5 pr-3'>
            {actions}
          </div>
        ) : null}
      </div>
      <CollapsibleContent>
        <div className='border-t border-border px-4 py-3'>{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
