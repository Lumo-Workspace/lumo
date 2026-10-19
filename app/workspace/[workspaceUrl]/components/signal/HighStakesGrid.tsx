'use client'

import { useIntl } from 'react-intl'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { idleDays, IDLE_SEVERE_DAYS } from '@/lib/summaries/signal-view'
import type { StalledBlockerItem } from '@/types/summary'
import { PriorityBadge } from '../PriorityBadge'

/** Idle badge — severe past the threshold, merely stale below it. */
function IdleBadge({ days }: { days: number | null }) {
  const intl = useIntl()
  if (days === null) {
    return (
      <span className='text-caption font-mono text-muted-foreground'>—</span>
    )
  }
  return (
    <span
      className={cn(
        'rounded-sm px-2 py-0.5 text-caption font-mono',
        days >= IDLE_SEVERE_DAYS
          ? 'bg-danger-subtle text-foreground'
          : 'bg-warning-subtle text-foreground'
      )}
    >
      {intl.formatMessage({ id: 'signal.idleDays' }, { d: days })}
    </span>
  )
}

interface HighStakesGridProps {
  tasks: StalledBlockerItem[]
  /** ms epoch from `useNow()`, or null before mount. */
  now: number | null
  onOpenTask: (taskId: string) => void
}

/**
 * High-stakes stalls, shown when that pill is expanded. Cards rather than table
 * rows: these are the few the reader is meant to actually act on, so each one
 * gets its title on its own line instead of being truncated into a column.
 */
export function HighStakesGrid({
  tasks,
  now,
  onOpenTask,
}: HighStakesGridProps) {
  return (
    <div
      data-testid='signal-panel-highStakes'
      className='grid grid-cols-1 gap-3 md:grid-cols-2'
    >
      {tasks.map(task => (
        <Card
          key={task.id}
          asChild
          className='px-4 py-3.5 text-left transition-colors hover:bg-muted'
        >
          <button type='button' onClick={() => onOpenTask(task.id)}>
            <div className='mb-1.5 flex items-center gap-2'>
              <PriorityBadge priority={task.priority} variant='dot' />
              <span className='text-caption font-mono text-muted-foreground'>
                {task.identifier}
              </span>
              <IdleBadge
                days={now === null ? null : idleDays(task.updatedAt, now)}
              />
            </div>
            <div className='text-body-strong text-foreground'>{task.title}</div>
          </button>
        </Card>
      ))}
    </div>
  )
}
