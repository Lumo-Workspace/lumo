'use client'

import { useSprintsForTeam } from '../../hooks/useSprints'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useIntl } from 'react-intl'
import type { SprintStatus } from '@prisma/client'
import { cn } from '@/lib/utils'

interface Task {
  id: string
  teamId: string
  sprintId: string | null
  sprint?: { id: string; status: SprintStatus; name: string } | null
}

export function TaskSprintField({
  task,
  onChange,
  triggerClassName,
}: {
  task: Task
  onChange: (sprintId: string | null) => void
  triggerClassName?: string
}) {
  const intl = useIntl()
  const { sprints: drafts } = useSprintsForTeam(task.teamId, 'DRAFT')
  const { sprints: active } = useSprintsForTeam(task.teamId, 'ACTIVE')

  const selectable = [...(active ?? []), ...(drafts ?? [])]
  const disabled = task.sprint?.status === 'CLOSED'

  // Value: 'none' sentinel for null sprintId, else the sprintId
  const value = task.sprintId ?? 'none'

  return (
    <Select
      value={value}
      onValueChange={v => onChange(v === 'none' ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className={cn(triggerClassName)}>
        <SelectValue
          placeholder={intl.formatMessage({ id: 'sprints.taskField.noSprint' })}
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='none'>
          {intl.formatMessage({ id: 'sprints.taskField.noSprint' })}
        </SelectItem>
        {selectable.map(s => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
