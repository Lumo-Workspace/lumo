'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import type { Sprint } from '@prisma/client'
import { sprintsClient } from '@/lib/api-client'
import {
  DatePickerField,
  startOfDay,
} from '../../components/fields/DatePickerField'

interface SprintDateRangeProps {
  sprint: Sprint
  /** Refetch the sprint after a successful date edit. */
  onRefresh: () => void
}

/**
 * Inline-editable sprint start–end range for the detail header. Reads like the
 * design's plain date text (ghost pickers) but opens a calendar on click, so the
 * detail page keeps the sprint-date editing that used to live in the removed
 * right-hand sidebar — the only web surface for it. Optimistic: the value flips
 * on pick, the server response reconciles (success toast / revert on error).
 */
export function SprintDateRange({ sprint, onRefresh }: SprintDateRangeProps) {
  const intl = useIntl()
  const [start, setStart] = useState<Date>(() => new Date(sprint.startDate))
  const [end, setEnd] = useState<Date>(() => new Date(sprint.endDate))

  useEffect(() => {
    setStart(new Date(sprint.startDate))
    setEnd(new Date(sprint.endDate))
  }, [sprint.startDate, sprint.endDate])

  async function applyChange(field: 'startDate' | 'endDate', next: Date) {
    const prevStart = start
    const prevEnd = end
    if (field === 'startDate') setStart(next)
    else setEnd(next)

    try {
      await sprintsClient.update(sprint.id, { [field]: next.toISOString() })
      toast.success(intl.formatMessage({ id: 'sprints.detail.dateUpdated' }))
      onRefresh()
    } catch (e) {
      setStart(prevStart)
      setEnd(prevEnd)
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  return (
    <span className='inline-flex items-center gap-1 text-body text-muted-foreground'>
      <DatePickerField
        variant='ghost'
        value={start}
        onChange={d => applyChange('startDate', startOfDay(d))}
      />
      <span aria-hidden>–</span>
      <DatePickerField
        variant='ghost'
        value={end}
        onChange={d => applyChange('endDate', startOfDay(d))}
      />
    </span>
  )
}
