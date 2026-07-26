'use client'

import { useIntl } from 'react-intl'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { idleDays, IDLE_SEVERE_DAYS } from '@/lib/summaries/signal-view'
import type { StalledBlockerItem, StalePrItem } from '@/types/summary'
import { PriorityBadge } from '../PriorityBadge'

interface NeedsAttentionPanelProps {
  highStakes: StalledBlockerItem[]
  stalled: StalledBlockerItem[]
  stalePrs: StalePrItem[]
  /** ms epoch from `useNow()`, or null before mount. */
  now: number | null
  onOpenTask: (taskId: string) => void
}

function SectionHeading({
  labelKey,
  count,
}: {
  labelKey: string
  count: number
}) {
  const intl = useIntl()
  return (
    <div className='mb-2.5 flex items-center gap-2 text-caption font-mono uppercase tracking-wider text-muted-foreground'>
      {intl.formatMessage({ id: labelKey })}
      <span className='rounded-sm bg-muted px-1.5 text-muted-foreground'>
        {count}
      </span>
    </div>
  )
}

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

export function NeedsAttentionPanel({
  highStakes,
  stalled,
  stalePrs,
  now,
  onOpenTask,
}: NeedsAttentionPanelProps) {
  const intl = useIntl()
  const daysSince = (iso: string) => (now === null ? null : idleDays(iso, now))

  // High-stakes stalls are a *subset* of the stalled set, promoted above the
  // table. Listing them again below would make the same task read as two
  // separate problems, and pad the table with rows the eye already passed.
  // Deduped here rather than by the caller: this component owns both sections,
  // so it is the only place that can know a row was already shown.
  const promotedIds = new Set(highStakes.map(t => t.id))
  const remainingStalled = stalled.filter(t => !promotedIds.has(t.id))

  return (
    <div className='flex flex-col gap-6'>
      {highStakes.length > 0 && (
        <section data-testid='signal-section-high-stakes'>
          <SectionHeading
            labelKey='signal.section.highStakes'
            count={highStakes.length}
          />
          <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
            {highStakes.map(task => (
              <button
                key={task.id}
                type='button'
                onClick={() => onOpenTask(task.id)}
                className='rounded-lg border border-border bg-card px-4 py-3.5 text-left transition-colors hover:bg-muted'
              >
                <div className='mb-1.5 flex items-center gap-2'>
                  <PriorityBadge priority={task.priority} variant='dot' />
                  <span className='text-caption font-mono text-muted-foreground'>
                    {task.identifier}
                  </span>
                  <IdleBadge days={daysSince(task.updatedAt)} />
                </div>
                <div className='text-body-strong text-foreground'>
                  {task.title}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {remainingStalled.length > 0 && (
        <section data-testid='signal-section-stalled'>
          <SectionHeading
            labelKey='signal.section.stalled'
            count={remainingStalled.length}
          />
          <div className='overflow-hidden rounded-lg border border-border'>
            <div className='grid grid-cols-[20px_100px_1fr_110px_90px] gap-3 border-b border-border bg-muted px-4 py-2 text-caption font-mono uppercase tracking-wider text-muted-foreground'>
              {/* Priority column: the dot is its own label. */}
              <span aria-hidden />
              <span>{intl.formatMessage({ id: 'signal.col.id' })}</span>
              <span>{intl.formatMessage({ id: 'signal.col.title' })}</span>
              <span>{intl.formatMessage({ id: 'signal.col.updated' })}</span>
              <span>{intl.formatMessage({ id: 'signal.col.idle' })}</span>
            </div>
            {remainingStalled.map(task => {
              const days = daysSince(task.updatedAt)
              return (
                <button
                  key={task.id}
                  type='button'
                  onClick={() => onOpenTask(task.id)}
                  className='grid w-full grid-cols-[20px_100px_1fr_110px_90px] items-center gap-3 border-b border-border px-4 py-2 text-left last:border-b-0 hover:bg-muted'
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
                        ? 'text-danger'
                        : 'text-warning'
                    )}
                  >
                    {days === null
                      ? '—'
                      : intl.formatMessage(
                          { id: 'signal.idleShort' },
                          { d: days }
                        )}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {stalePrs.length > 0 && (
        <section data-testid='signal-section-stale-prs'>
          <SectionHeading
            labelKey='signal.section.stalePrs'
            count={stalePrs.length}
          />
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
            {stalePrs.map(pr => {
              const days = daysSince(pr.openedAt)
              return (
                <a
                  key={pr.number}
                  href={pr.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-muted'
                >
                  <span className='text-body-strong font-mono text-foreground'>
                    #{pr.number}
                  </span>
                  <span className='text-caption text-muted-foreground'>
                    {days === null
                      ? '—'
                      : intl.formatMessage(
                          { id: 'signal.prInReview' },
                          { d: days }
                        )}
                  </span>
                  <ArrowUpRight
                    className='ml-auto size-3.5 text-muted-foreground'
                    aria-hidden
                  />
                </a>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
