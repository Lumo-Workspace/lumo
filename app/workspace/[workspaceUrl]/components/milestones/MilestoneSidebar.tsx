'use client'

import { useId } from 'react'
import { useIntl } from 'react-intl'
import type { ApiMilestone, MilestoneUpdateInput } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { MilestoneStatus } from '@prisma/client'
import { MILESTONE_STATUSES } from './milestoneDisplay'

interface MilestoneSidebarProps {
  status: ApiMilestone['status']
  startDate: string | null
  targetDate: string | null
  archived: boolean
  onUpdate: (fields: MilestoneUpdateInput) => void
}

/**
 * Milestone metadata rail. Inline-editable status + dates; receives only flat
 * fields (ISP/LoD) and reports single-field patches via onUpdate. Read-only
 * when archived.
 */
export function MilestoneSidebar({
  status,
  startDate,
  targetDate,
  archived,
  onUpdate,
}: MilestoneSidebarProps) {
  const intl = useIntl()
  const fieldId = useId()
  return (
    <div className='flex flex-col gap-4 px-4 pb-6 text-sm lg:px-0'>
      <section>
        <label
          htmlFor={`${fieldId}-status`}
          className='text-xs font-medium text-muted-foreground'
        >
          {intl.formatMessage({ id: 'milestone.field.status' })}
        </label>
        <div className='mt-1 flex items-center gap-2'>
          <Select
            value={status}
            onValueChange={v => onUpdate({ status: v as MilestoneStatus })}
            disabled={archived}
          >
            <SelectTrigger id={`${fieldId}-status`} className='h-7 w-full text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MILESTONE_STATUSES.map(s => (
                <SelectItem key={s} value={s}>
                  {intl.formatMessage({ id: `milestone.status.${s}` })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {archived ? (
            <span className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
              {intl.formatMessage({ id: 'milestone.archived' })}
            </span>
          ) : null}
        </div>
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
      </section>
    </div>
  )
}
