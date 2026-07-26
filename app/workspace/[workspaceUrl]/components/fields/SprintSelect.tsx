'use client'

import { useMemo, useState } from 'react'
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
import { groupSprintsForTaskField } from '@/lib/services/sprint-date'
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
 * Standalone Sprint picker used in NewTaskModal. Lists the team's sprints
 * whose calendar window is current, upcoming, or just-ended — the same set
 * TaskSprintField offers, and the same set the server accepts a task into.
 * The DB status enum is not consulted (LUM-705): a sprint closed early is
 * still the window the team is working in.
 */
export function SprintSelect({
  teamId,
  value,
  onChange,
  triggerClassName,
}: SprintSelectProps) {
  const intl = useIntl()
  const { sprints } = useSprintsForTeam(teamId)
  // Stable across renders — render purity (see TaskSprintField).
  const [now] = useState(() => new Date())
  const selectable = useMemo(() => {
    const { activeAndUpcoming, past } = groupSprintsForTaskField(
      sprints ?? [],
      now
    )
    return [...activeAndUpcoming, ...past]
  }, [sprints, now])
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
              <span className='text-muted-foreground'>{noSprintLabel}</span>
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
