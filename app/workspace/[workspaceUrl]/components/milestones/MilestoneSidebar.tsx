'use client'

import { useId } from 'react'
import { useIntl } from 'react-intl'
import type { MilestoneUpdateInput } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import type { MilestoneState } from '@/lib/summaries/milestone-state'

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
    <div className='flex flex-col gap-4 px-4 pb-6 text-sm lg:px-0'>
      <section>
        <span className='text-xs font-medium text-muted-foreground'>
          {intl.formatMessage({ id: 'milestone.field.state' })}
        </span>
        <p className='mt-1 text-xs text-foreground'>
          {intl.formatMessage({ id: `milestone.state.${state}` })}
        </p>
      </section>

      <section>
        <label
          htmlFor={`${fieldId}-start`}
          className='text-xs font-medium text-muted-foreground'
        >
          {intl.formatMessage({ id: 'milestone.field.startDate' })}
        </label>
        <Input
          id={`${fieldId}-start`}
          type='date'
          className='mt-1 h-7 text-xs'
          value={startDate?.slice(0, 10) ?? ''}
          disabled={archived}
          onChange={e => onUpdate({ startDate: e.target.value || null })}
        />
      </section>

      <section>
        <label
          htmlFor={`${fieldId}-target`}
          className='text-xs font-medium text-muted-foreground'
        >
          {intl.formatMessage({ id: 'milestone.field.targetDate' })}
        </label>
        <Input
          id={`${fieldId}-target`}
          type='date'
          className='mt-1 h-7 text-xs'
          value={targetDate?.slice(0, 10) ?? ''}
          disabled={archived}
          onChange={e => onUpdate({ targetDate: e.target.value || null })}
        />
        {datesMissing ? (
          <p className='mt-1 text-xs text-muted-foreground'>
            {intl.formatMessage({ id: 'milestone.staleness.datesMissing' })}
          </p>
        ) : null}
      </section>
    </div>
  )
}
