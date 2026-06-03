'use client'

import { useIntl } from 'react-intl'
import type { ApiMilestone } from '@/lib/api-client'
import { useFormatDate } from '../../hooks/useFormatDate'

const STATUS_CLASS: Record<ApiMilestone['status'], string> = {
  PLANNED: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  ACTIVE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  COMPLETED:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  CANCELLED: 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-500',
}

// Calendar dates stored at UTC midnight — format in UTC so the shown day
// matches what was entered regardless of the viewer's time zone.
const DATE_OPTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
}

interface MilestoneSidebarProps {
  status: ApiMilestone['status']
  startDate: string | null
  targetDate: string | null
  description: string | null
  archived: boolean
}

/** Milestone metadata rail. Receives only flat fields (ISP/LoD). */
export function MilestoneSidebar({
  status,
  startDate,
  targetDate,
  description,
  archived,
}: MilestoneSidebarProps) {
  const intl = useIntl()
  const { fmtDate } = useFormatDate()
  return (
    <div className='flex flex-col gap-4 px-4 pb-6 text-sm lg:px-0'>
      <section>
        <div className='text-xs font-medium text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.field.status' })}
        </div>
        <div className='mt-1 flex items-center gap-2'>
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}
          >
            {intl.formatMessage({ id: `milestone.status.${status}` })}
          </span>
          {archived ? (
            <span className='rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
              {intl.formatMessage({ id: 'milestone.archived' })}
            </span>
          ) : null}
        </div>
      </section>

      <section>
        <div className='text-xs font-medium text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.field.targetDate' })}
        </div>
        <div className='mt-1 text-zinc-600 dark:text-zinc-300'>
          {startDate ? <span>{fmtDate(startDate, DATE_OPTS)} → </span> : null}
          <span>
            {targetDate
              ? fmtDate(targetDate, DATE_OPTS)
              : intl.formatMessage({ id: 'milestone.targetDate.none' })}
          </span>
        </div>
      </section>

      {description ? (
        <section>
          <div className='text-xs font-medium text-muted-foreground'>
            {intl.formatMessage({ id: 'milestone.field.description' })}
          </div>
          <p className='mt-1 whitespace-pre-wrap text-zinc-600 dark:text-zinc-300'>
            {description}
          </p>
        </section>
      ) : null}
    </div>
  )
}
