'use client'

import { useIntl } from 'react-intl'
import type { Sprint } from '@prisma/client'
import { useNow } from '@/hooks/use-now'
import {
  deriveSprintState,
  type DerivedSprintState,
} from '@/lib/services/sprint-date'
import { formatCalendarDayShort } from '@/lib/datetime/format'
import { SprintBurnupCard } from './SprintBurnupCard'
import { SprintDateRange } from './SprintDateRange'

interface SprintHeaderProps {
  sprint: Sprint
  progress: { done: number; total: number }
  /** Refetch after an inline sprint-date edit in the header. */
  onRefresh: () => void
}

const STATE_I18N_KEY: Record<DerivedSprintState, string> = {
  UPCOMING: 'sprints.state.upcoming',
  CURRENT: 'sprints.state.current',
  COMPLETED: 'sprints.state.completed',
}

// Neutral text + a semantic subtle fill/border carries the state colour
// (design-system rule: badge copy stays foreground-neutral, colour signals via
// bg/border), so it survives lint:tokens and both light/dark modes.
const STATE_BADGE: Record<DerivedSprintState, string> = {
  UPCOMING: 'bg-muted text-muted-foreground',
  CURRENT: 'border border-info-border bg-info-subtle text-foreground',
  COMPLETED: 'border border-success-border bg-success-subtle text-foreground',
}

/**
 * The sprint detail page's header — name + derived state + inline-editable
 * dates, over a single burnup card. Progress and time-left used to be two more
 * cards of their own; they now read out on one line inside the burnup card, so
 * the page opens with one frame instead of three.
 */
export function SprintHeader({
  sprint,
  progress,
  onRefresh,
}: SprintHeaderProps) {
  const intl = useIntl()

  // Reading the clock during render breaks purity, so the state pill waits for
  // `useNow`'s post-mount tick rather than deriving off a render-time `new
  // Date()` (the board's own convention — see SprintsBoard).
  const now = useNow()
  const state = now === null ? null : deriveSprintState(sprint, new Date(now))

  // The year is already carried by the editable range on the title row, so the
  // card's own dates stay compact.
  const fmtDate = (d: string | Date) => formatCalendarDayShort(d, intl.locale)

  return (
    <div className='flex flex-col gap-3.5'>
      {/* Title over dates, not beside them: the header lives in the ~320px
          right rail, where a name + state pill + editable range on one row has
          nowhere to go but wrap unevenly. */}
      <div className='flex flex-col gap-1'>
        <div className='flex flex-wrap items-center gap-x-2.5 gap-y-1'>
          <span className='text-title font-semibold tracking-tight'>
            {sprint.name}
          </span>
          {state && (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-caption font-medium ${STATE_BADGE[state]}`}
            >
              {intl.formatMessage({ id: STATE_I18N_KEY[state] })}
            </span>
          )}
        </div>
        <SprintDateRange sprint={sprint} onRefresh={onRefresh} />
      </div>

      <SprintBurnupCard
        sprintId={sprint.id}
        progress={progress}
        endLabel={fmtDate(sprint.endDate)}
        formatDate={fmtDate}
      />
    </div>
  )
}
