'use client'

import { useIntl } from 'react-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useMilestones } from '../../hooks/useMilestones'
import { useFormatDate } from '../../hooks/useFormatDate'

interface Props {
  projectId: string
  value: string | null
  onChange: (milestoneId: string | null) => void
  triggerClassName?: string
}

const NONE_VALUE = '__none__'

// Calendar date stored at UTC midnight — format in UTC to avoid day drift.
const DATE_OPTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
}

/**
 * Right-rail selector for a task's milestone. Filters out CANCELLED
 * milestones (re-binding to a cancelled milestone is rarely intentional).
 */
export function TaskMilestoneField({
  projectId,
  value,
  onChange,
  triggerClassName,
}: Props) {
  const intl = useIntl()
  const { fmtDate } = useFormatDate()
  const { milestones } = useMilestones(projectId)

  const selectable = milestones.filter(m => m.status !== 'CANCELLED')

  return (
    <Select
      value={value ?? NONE_VALUE}
      onValueChange={v => onChange(v === NONE_VALUE ? null : v)}
    >
      <SelectTrigger className={triggerClassName}>
        <SelectValue
          placeholder={intl.formatMessage({ id: 'task.field.milestone' })}
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>
          {intl.formatMessage({ id: 'task.field.milestone.none' })}
        </SelectItem>
        {selectable.map(m => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}
            {m.targetDate ? ` · ${fmtDate(m.targetDate, DATE_OPTS)}` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
