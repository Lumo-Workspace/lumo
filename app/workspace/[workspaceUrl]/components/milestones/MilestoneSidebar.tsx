'use client'

import { useId } from 'react'
import { useIntl } from 'react-intl'
import type { MilestoneUpdateInput } from '@/lib/api-client'
import { Label } from '@/components/ui/label'
import type { MilestoneState } from '@/lib/summaries/milestone-state'
import { CalendarDayPicker } from '../fields/CalendarDayPicker'

interface MilestoneSidebarProps {
  /**
   * LUM-714: the milestone's derived state. Read-only — there is no status to
   * pick any more. `completed` follows task completion; `archived` is flipped
   * from the actions menu, not from this rail.
   */
  state: MilestoneState
  startDate: string | null
  targetDate: string | null
  archived: boolean
  /** In-flight milestone with no target date — schedule health unavailable. */
  datesMissing?: boolean
  onUpdate: (fields: MilestoneUpdateInput) => void
}

/**
 * Milestone metadata rail. Inline-editable dates plus a read-out of the
 * derived state; receives only flat fields (ISP/LoD) and reports single-field
 * patches via onUpdate. Read-only when archived.
 */
export function MilestoneSidebar({
  state,
  startDate,
  targetDate,
  archived,
  datesMissing = false,
  onUpdate,
}: MilestoneSidebarProps) {
  const intl = useIntl()
  const fieldId = useId()
  return (
    <div className='flex flex-col gap-4 px-4 pb-6 text-body lg:px-0'>
      <section>
        <span className='text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.field.state' })}
        </span>
        <p className='mt-1 text-caption text-foreground'>
          {intl.formatMessage({ id: `milestone.state.${state}` })}
        </p>
      </section>

      <section>
        <Label
          htmlFor={`${fieldId}-start`}
          className='text-caption text-muted-foreground'
        >
          {intl.formatMessage({ id: 'milestone.field.startDate' })}
        </Label>
        <CalendarDayPicker
          id={`${fieldId}-start`}
          className='mt-2 h-8'
          value={startDate ?? ''}
          placeholder={intl.formatMessage({ id: 'milestone.hero.notSet' })}
          disabled={archived}
          clearable
          onChange={v => onUpdate({ startDate: v || null })}
        />
      </section>

      <section>
        <Label
          htmlFor={`${fieldId}-target`}
          className='text-caption text-muted-foreground'
        >
          {intl.formatMessage({ id: 'milestone.field.targetDate' })}
        </Label>
        <CalendarDayPicker
          id={`${fieldId}-target`}
          className='mt-2 h-8'
          value={targetDate ?? ''}
          placeholder={intl.formatMessage({ id: 'milestone.hero.notSet' })}
          disabled={archived}
          clearable
          onChange={v => onUpdate({ targetDate: v || null })}
        />
        {datesMissing ? (
          <p className='mt-1 text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'milestone.staleness.datesMissing' })}
          </p>
        ) : null}
      </section>
    </div>
  )
}
