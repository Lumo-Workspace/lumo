'use client'

import { useMemo } from 'react'
import { useSprintsForTeam } from '../../hooks/useSprints'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useIntl } from 'react-intl'
import type { Sprint, SprintStatus } from '@prisma/client'
import { cn } from '@/lib/utils'
import {
  deriveSprintState,
  type DerivedSprintState,
} from '@/lib/services/sprint-date'
import { CircleDot, Circle, CircleCheck } from 'lucide-react'

interface Task {
  id: string
  teamId: string
  sprintId: string | null
  sprint?: { id: string; status: SprintStatus; name: string } | null
}

const STATUS_LABEL_KEY: Record<DerivedSprintState, string> = {
  CURRENT: 'sprints.taskField.group.current',
  UPCOMING: 'sprints.taskField.group.upcoming',
  COMPLETED: 'sprints.taskField.group.past',
}

const STATUS_ICON: Record<DerivedSprintState, typeof Circle> = {
  CURRENT: CircleDot,
  UPCOMING: Circle,
  COMPLETED: CircleCheck,
}

const STATUS_ICON_CLS: Record<DerivedSprintState, string> = {
  CURRENT: 'text-emerald-500',
  UPCOMING: 'text-sky-500',
  COMPLETED: 'text-muted-foreground',
}

function formatCompactRange(s: Sprint, locale: string): string {
  const start = new Date(s.startDate)
  const end = new Date(s.endDate)
  const sameYear = start.getFullYear() === end.getFullYear()
  const thisYear = new Date().getFullYear() === start.getFullYear()
  const fmtShort: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
  }
  const fmtFull: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }
  if (sameYear && thisYear) {
    return `${start.toLocaleDateString(locale, fmtShort)} – ${end.toLocaleDateString(locale, fmtShort)}`
  }
  if (sameYear) {
    return `${start.toLocaleDateString(locale, fmtShort)} – ${end.toLocaleDateString(locale, fmtFull)}`
  }
  return `${start.toLocaleDateString(locale, fmtFull)} – ${end.toLocaleDateString(locale, fmtFull)}`
}

function sortByStart(sprints: Sprint[], desc = false): Sprint[] {
  const sign = desc ? -1 : 1
  return [...sprints].sort(
    (a, b) =>
      sign * (new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
  )
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

  const { activeAndUpcoming, past } = useMemo(() => {
    const all = [...(active ?? []), ...(drafts ?? [])]
    const current: Sprint[] = []
    const upcoming: Sprint[] = []
    const completed: Sprint[] = []
    for (const s of all) {
      const state = deriveSprintState(s)
      if (state === 'CURRENT') current.push(s)
      else if (state === 'UPCOMING') upcoming.push(s)
      else completed.push(s)
    }
    return {
      activeAndUpcoming: [...sortByStart(current), ...sortByStart(upcoming)],
      past: sortByStart(completed, true),
    }
  }, [active, drafts])

  const disabled = task.sprint?.status === 'CLOSED'
  const value = task.sprintId ?? 'none'

  // Resolve the displayed name from the loaded list (so optimistic
  // sprintId changes paint instantly, before the parent's task.sprint
  // relation is refreshed from the server).
  const selectedName =
    [...(active ?? []), ...(drafts ?? [])].find(s => s.id === task.sprintId)
      ?.name ?? task.sprint?.name

  const renderItem = (s: Sprint) => {
    const state = deriveSprintState(s)
    const Icon = STATUS_ICON[state]
    return (
      <SelectItem key={s.id} value={s.id}>
        <span className='flex w-full items-center gap-3'>
          <Icon className={cn('size-3.5 shrink-0', STATUS_ICON_CLS[state])} />
          <span className='flex-1 truncate'>{s.name}</span>
          <span className='w-32 shrink-0 text-right text-xs tabular-nums text-muted-foreground'>
            {formatCompactRange(s, intl.locale)}
          </span>
          <span className='w-16 shrink-0 text-xs text-muted-foreground/80'>
            {intl.formatMessage({ id: STATUS_LABEL_KEY[state] })}
          </span>
        </span>
      </SelectItem>
    )
  }

  return (
    <Select
      value={value}
      onValueChange={v => onChange(v === 'none' ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className={cn(triggerClassName)}>
        <SelectValue
          placeholder={intl.formatMessage({ id: 'sprints.taskField.noSprint' })}
        >
          {selectedName}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className='min-w-[18rem]'>
        <SelectItem value='none'>
          {intl.formatMessage({ id: 'sprints.taskField.noSprint' })}
        </SelectItem>
        {activeAndUpcoming.map(renderItem)}
        {past.length > 0 && activeAndUpcoming.length > 0 && <SelectSeparator />}
        {past.map(renderItem)}
      </SelectContent>
    </Select>
  )
}
