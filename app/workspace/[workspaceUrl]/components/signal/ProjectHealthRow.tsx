'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  AnomalyCard,
  SignalKey,
  SignalView,
} from '@/lib/summaries/signal-view'
import type { StalledBlockerItem, StalePrItem } from '@/types/summary'
import { PropertyRow } from '../pages/project-detail/PropertyRow'
import { StalledTable } from './StalledTable'
import { HighStakesGrid } from './HighStakesGrid'
import { StalePrList } from './StalePrList'

/**
 * Signals whose detail the stats endpoint actually carries. `overdue` is
 * deliberately absent: `stats.overdueTasks` is a bare `{count, taskIds}` with
 * no titles or timestamps, so an expanded panel would have nothing readable to
 * show. Its pill stays inert rather than opening an empty drawer.
 */
const EXPANDABLE: ReadonlySet<SignalKey> = new Set<SignalKey>([
  'stalled',
  'highStakes',
  'stalePrs',
])

/**
 * Pill skin per tone. Colour lives on the surface and the leading dot; the text
 * stays `text-foreground` because the accent hues fail AA as body text.
 */
const TONE_PILL: Record<AnomalyCard['tone'], string> = {
  danger: 'border-danger-border bg-danger-subtle',
  warning: 'border-warning-border bg-warning-subtle',
}

const TONE_DOT: Record<AnomalyCard['tone'], string> = {
  danger: 'bg-danger',
  warning: 'bg-warning-text',
}

interface ProjectHealthRowProps {
  /** Row label — supplied by the page so the gutter copy stays in one place. */
  label: string
  view: SignalView
  stalled: StalledBlockerItem[]
  highStakes: StalledBlockerItem[]
  stalePrs: StalePrItem[]
  /** ms epoch from `useNow()`, or null before mount. */
  now: number | null
  onOpenTask: (taskId: string) => void
  onViewAllTasks?: (() => void) | undefined
}

/**
 * The project's health as one wrapping row of pills: every signal that fired
 * gets a coloured pill, and a signal that didn't gets nothing at all. Firing
 * signals that carry detail open it below the row, one at a time — the row
 * stays a summary, and the reader chooses which problem to unfold.
 */
export function ProjectHealthRow({
  label,
  view,
  stalled,
  highStakes,
  stalePrs,
  now,
  onOpenTask,
  onViewAllTasks,
}: ProjectHealthRowProps) {
  const intl = useIntl()
  const [open, setOpen] = useState<SignalKey | null>(null)

  // High-stakes tasks are a subset of `stalled` and are NOT filtered out of the
  // stalled panel. Only one panel is open at a time, so a task can never read
  // as two separate problems on screen — and every pill's number then equals
  // the number of rows its own panel shows, which is what makes the counts
  // checkable against the page.
  const detail = (key: SignalKey) => {
    switch (key) {
      case 'stalled':
        return (
          <StalledTable
            tasks={stalled}
            now={now}
            onOpenTask={onOpenTask}
            onViewAll={onViewAllTasks}
          />
        )
      case 'highStakes':
        return (
          <HighStakesGrid
            tasks={highStakes}
            now={now}
            onOpenTask={onOpenTask}
          />
        )
      case 'stalePrs':
        return <StalePrList prs={stalePrs} now={now} />
      default:
        return null
    }
  }

  return (
    // The pills sit in the property gutter with the rows above them, but the
    // detail panel is a sibling of that row, not a child of its value column:
    // an expanded table indented under a 90px label would read as a footnote to
    // the pill rather than as the project's open problem.
    <div className='flex flex-col gap-3'>
      <PropertyRow label={label}>
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
          {/* Nothing fired — say so once. Listing each quiet signal was the
              reader's job to filter: a real problem is already sitting here as
              a pill, so the absence of pills is the all-clear. */}
          {view.anomalies.length === 0 && (
            <span
              data-testid='signal-all-clear'
              className='text-caption text-muted-foreground'
            >
              {intl.formatMessage({ id: 'signal.allClear' })}
            </span>
          )}
          {view.anomalies.map(card => {
            const expandable = EXPANDABLE.has(card.key)
            const isOpen = open === card.key
            const pillLabel = (
              <>
                <span
                  className={cn('size-1.5 rounded-full', TONE_DOT[card.tone])}
                  aria-hidden
                />
                {intl.formatMessage(
                  { id: `signal.pill.${card.key}` },
                  { count: card.count }
                )}
              </>
            )
            const skin = cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-caption font-medium text-foreground',
              TONE_PILL[card.tone]
            )

            if (!expandable) {
              return (
                <span
                  key={card.key}
                  data-testid={`signal-pill-${card.key}`}
                  className={skin}
                >
                  {pillLabel}
                </span>
              )
            }

            return (
              <button
                key={card.key}
                type='button'
                data-testid={`signal-pill-${card.key}`}
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen(prev => (prev === card.key ? null : card.key))
                }
                className={cn(skin, 'transition-colors hover:brightness-95')}
              >
                {pillLabel}
                <ChevronDown
                  className={cn(
                    'size-3 text-muted-foreground transition-transform',
                    isOpen && 'rotate-180'
                  )}
                  aria-hidden
                />
              </button>
            )
          })}
        </div>
      </PropertyRow>

      {open && detail(open)}
    </div>
  )
}
