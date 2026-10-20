'use client'

import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import type { ApiProjectStatus, ProjectUpdateFields } from '../../../types'
import { FIELD_TRIGGER_CLS, ProjectStatusSelect } from '../../fields'
import { CalendarDayPicker } from '../../fields/CalendarDayPicker'
import { PropertyRow } from './PropertyRow'

interface ProjectLifecycleRowsProps {
  status: ApiProjectStatus
  /** `YYYY-MM-DD` or ISO, or null when unset. */
  startDate: string | null
  targetDate: string | null
  /** Derived by the server — at least one task and none open. */
  completed: boolean
  archived: boolean
  onChange: (fields: ProjectUpdateFields) => void
}

/**
 * LUM-1285: the Status and Dates rows of the project page. Status is a human
 * ruling (ACTIVE / PAUSED / CANCELED); "Completed" is a derived read-out next
 * to it, never a value to pick. Receives only flat fields and reports
 * single-field patches through `onChange`.
 */
export function ProjectLifecycleRows({
  status,
  startDate,
  targetDate,
  completed,
  archived,
  onChange,
}: ProjectLifecycleRowsProps) {
  const intl = useIntl()
  const notSet = intl.formatMessage({ id: 'project.dates.notSet' })
  return (
    <>
      <PropertyRow label={intl.formatMessage({ id: 'project.status.label' })}>
        <ProjectStatusSelect
          value={status}
          onChange={next => {
            if (next !== status) onChange({ status: next })
          }}
          triggerClassName={cn(FIELD_TRIGGER_CLS, 'h-7 text-caption')}
        />
        {completed ? (
          <Badge variant='success' size='sm'>
            {intl.formatMessage({ id: 'project.completedDerived' })}
          </Badge>
        ) : null}
        {archived ? (
          <Badge variant='muted' size='sm'>
            {intl.formatMessage({ id: 'project.archivedBadge' })}
          </Badge>
        ) : null}
      </PropertyRow>

      <PropertyRow label={intl.formatMessage({ id: 'project.dates.label' })}>
        <div className='w-40'>
          <CalendarDayPicker
            className='h-7 text-caption'
            aria-label={intl.formatMessage({ id: 'project.dates.start' })}
            value={startDate ?? ''}
            max={targetDate ? targetDate.slice(0, 10) : undefined}
            placeholder={`${intl.formatMessage({ id: 'project.dates.start' })}: ${notSet}`}
            clearable
            onChange={v => onChange({ startDate: v || null })}
          />
        </div>
        <span className='text-caption text-muted-foreground'>→</span>
        <div className='w-40'>
          <CalendarDayPicker
            className='h-7 text-caption'
            aria-label={intl.formatMessage({ id: 'project.dates.target' })}
            value={targetDate ?? ''}
            min={startDate ? startDate.slice(0, 10) : undefined}
            placeholder={`${intl.formatMessage({ id: 'project.dates.target' })}: ${notSet}`}
            clearable
            onChange={v => onChange({ targetDate: v || null })}
          />
        </div>
      </PropertyRow>
    </>
  )
}
