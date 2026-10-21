'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import type { Sprint } from '@prisma/client'
import type { DerivedSprintState } from '@/lib/services/sprint-date'
import { Badge } from '@/components/ui/badge'
import { SprintDateRange } from '../SprintDateRange'

const STATE_I18N_KEY: Record<DerivedSprintState, string> = {
  UPCOMING: 'sprints.state.upcoming',
  CURRENT: 'sprints.state.current',
  COMPLETED: 'sprints.state.completed',
}

interface SprintDetailHeaderProps {
  /** Handed to the inline date editor, which patches the sprint itself. */
  sprint: Sprint
  name: string
  teamName: string | null
  /** Null before mount (`useNow`), so the pill waits rather than guessing. */
  state: DerivedSprintState | null
  /** Whole days until the inclusive end; null before mount. */
  daysLeft: number | null
  onRefresh: () => void
  /** The page's actions — live (`LiveSprintActions`) or closed
   *  (`ClosedSprintActions`), composed by the page. */
  actions: ReactNode
}

/** Title, state, team · dates · days left, and the page's actions slot. */
export function SprintDetailHeader({
  sprint,
  name,
  teamName,
  state,
  daysLeft,
  onRefresh,
  actions,
}: SprintDetailHeaderProps) {
  const intl = useIntl()
  return (
    <section className='flex flex-wrap items-start justify-between gap-4'>
      <div className='flex min-w-0 flex-col gap-1.5'>
        <div className='flex flex-wrap items-center gap-2'>
          <h1 className='text-heading'>{name}</h1>
          {state && (
            <Badge variant='outline' size='sm'>
              {intl.formatMessage({ id: STATE_I18N_KEY[state] })}
            </Badge>
          )}
        </div>
        <p className='flex flex-wrap items-center gap-x-1.5 text-body text-muted-foreground'>
          {teamName && (
            <>
              <span>{teamName}</span>
              <span aria-hidden>·</span>
            </>
          )}
          <SprintDateRange sprint={sprint} onRefresh={onRefresh} />
          {state === 'CURRENT' && daysLeft !== null && (
            <>
              <span aria-hidden>·</span>
              <span>
                {intl.formatMessage(
                  { id: 'sprints.landing.daysLeft' },
                  { count: daysLeft }
                )}
              </span>
            </>
          )}
        </p>
      </div>
      <div className='flex w-full gap-2 sm:w-auto'>{actions}</div>
    </section>
  )
}
