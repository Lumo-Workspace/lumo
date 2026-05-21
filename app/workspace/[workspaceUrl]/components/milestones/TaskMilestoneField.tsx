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

interface Props {
  projectId: string
  value: string | null
  onChange: (milestoneId: string | null) => void
  triggerClassName?: string
}

const NONE_VALUE = '__none__'

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
            {m.targetDate ? ` · ${m.targetDate.slice(0, 10)}` : ''}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
