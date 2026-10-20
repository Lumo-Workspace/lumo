'use client'

import { useIntl } from 'react-intl'
import { Plus } from 'lucide-react'
import type { Sprint } from '@prisma/client'
import type { DerivedSprintState } from '@/lib/services/sprint-date'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  canClose: boolean
  onRefresh: () => void
  onCloseSprint: () => void
  onNewTask: () => void
}

/**
 * Title, state, team · dates · days left, and the page's two actions: "Close
 * sprint" (outline) and the single primary "New task".
 */
export function SprintDetailHeader({
  sprint,
  name,
  teamName,
  state,
  daysLeft,
  canClose,
  onRefresh,
  onCloseSprint,
  onNewTask,
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
      <div className='flex w-full gap-2 sm:w-auto'>
        {canClose && (
          <Button
            variant='outline'
            className='flex-1 sm:flex-none'
            onClick={onCloseSprint}
          >
            {intl.formatMessage({ id: 'sprints.detail.closeSprint' })}
          </Button>
        )}
        <Button className='flex-1 sm:flex-none' onClick={onNewTask}>
          <Plus className='size-4' />
          {intl.formatMessage({ id: 'sprints.detail.newTask' })}
        </Button>
      </div>
    </section>
  )
}
