'use client'

import { useIntl } from 'react-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useSprintsForTeam } from '../../hooks/useSprints'

export interface SprintSelectProps {
  /** Team whose sprints should be listed. `null` disables loading. */
  teamId: string | null
  /** Selected sprint id, or null for "no sprint". */
  value: string | null
  onChange: (sprintId: string | null) => void
  triggerClassName?: string
}

/**
 * Standalone Sprint picker used in NewTaskModal. Loads ACTIVE + DRAFT sprints
 * for the given team — only these are valid targets for new tasks. For
 * editing an existing task, see TaskSprintField (which carries the task's
 * current sprint even when CLOSED).
 */
export function SprintSelect({
  teamId,
  value,
  onChange,
  triggerClassName,
}: SprintSelectProps) {
  const intl = useIntl()
  const { sprints: active } = useSprintsForTeam(teamId, 'ACTIVE')
  const { sprints: draft } = useSprintsForTeam(teamId, 'DRAFT')
  const selectable = [...(active ?? []), ...(draft ?? [])]
  const selected = selectable.find(s => s.id === value)
  const selectValue = value ?? 'none'
  const noSprintLabel = intl.formatMessage({ id: 'sprints.taskField.noSprint' })

  return (
    <Select
      value={selectValue}
      onValueChange={v => onChange(v === 'none' ? null : v)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger className={triggerClassName}>
            {selected ? (
              <span>{selected.name}</span>
            ) : (
              <span className='text-zinc-400'>{noSprintLabel}</span>
            )}
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>Sprint</TooltipContent>
      </Tooltip>
      <SelectContent>
        <SelectItem value='none'>{noSprintLabel}</SelectItem>
        {selectable.map(s => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
