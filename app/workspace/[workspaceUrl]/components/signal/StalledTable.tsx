'use client'

import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'
import { idleDays, IDLE_SEVERE_DAYS } from '@/lib/summaries/signal-view'
import type { StalledBlockerItem } from '@/types/summary'
import { PriorityBadge } from '../PriorityBadge'

// The row template plus a floor wide enough that the title column stays
// readable. Below that the table scrolls inside its own box (see the wrapper)
// rather than clipping columns off the right edge on a phone.
const COLUMNS = 'grid-cols-[20px_92px_1fr_84px_56px] min-w-[520px]'

interface StalledTableProps {
  tasks: StalledBlockerItem[]
  /** ms epoch from `useNow()`, or null before mount. */
  now: number | null
  onOpenTask: (taskId: string) => void
  /** Jumps to the Tasks tab; omitted when there is nowhere to send the user. */
  onViewAll?: (() => void) | undefined
}

/**
 * The stalled-task detail table, shown when the stalled pill is expanded.
 *
 * Rows are buttons rather than links: the task detail opens in place through
 * the workspace router, so there is no URL to hand an anchor.
 */
export function StalledTable({
  tasks,
  now,
  onOpenTask,
  onViewAll,
}: StalledTableProps) {
  const intl = useIntl()

  return (
    <div
      data-testid='signal-panel-stalled'
      className='overflow-x-auto rounded-lg border border-border'
    >
      <div
        className={cn(
          'grid gap-3 border-b border-border bg-muted px-4 py-2 text-caption uppercase tracking-wider text-muted-foreground',
          COLUMNS
        )}
      >
        {/* Priority column: the dot is its own label. */}
        <span aria-hidden />
        <span>{intl.formatMessage({ id: 'signal.col.id' })}</span>
        <span>
          {intl.formatMessage(
            { id: 'signal.panel.stalled' },
            { count: tasks.length }
          )}
        </span>
        <span>{intl.formatMessage({ id: 'signal.col.updated' })}</span>
        <span>{intl.formatMessage({ id: 'signal.col.idle' })}</span>
      </div>

      {tasks.map(task => {
        const days = now === null ? null : idleDays(task.updatedAt, now)
        return (
          <button
            key={task.id}
            type='button'
            onClick={() => onOpenTask(task.id)}
            className={cn(
              'grid w-full items-center gap-3 border-b border-border px-4 py-2 text-left last:border-b-0 hover:bg-muted',
              COLUMNS
            )}
          >
            <PriorityBadge priority={task.priority} variant='dot' />
            <span className='text-caption font-mono text-muted-foreground'>
              {task.identifier}
            </span>
            <span className='truncate text-body text-foreground'>
              {task.title}
            </span>
            <span className='text-caption font-mono text-muted-foreground'>
              {intl.formatDate(task.updatedAt, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span
              className={cn(
                'text-caption font-mono',
                days !== null && days >= IDLE_SEVERE_DAYS
                  ? 'text-danger-text'
                  : 'text-warning-text'
              )}
            >
              {days === null
                ? '—'
                : intl.formatMessage({ id: 'signal.idleShort' }, { d: days })}
            </span>
          </button>
        )
      })}

      {onViewAll && (
        <button
          type='button'
          onClick={onViewAll}
          className='w-full min-w-[520px] bg-muted px-4 py-2 text-left text-caption text-muted-foreground hover:text-foreground'
        >
          {intl.formatMessage(
            { id: 'signal.viewAllInTasks' },
            { count: tasks.length }
          )}
        </button>
      )}
    </div>
  )
}
