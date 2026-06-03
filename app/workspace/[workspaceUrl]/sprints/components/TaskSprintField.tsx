'use client'

import { useMemo } from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check } from 'lucide-react'
import { useSprintsForTeam } from '../../hooks/useSprints'
import { FieldValueSkeleton } from '../../components/fields'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from '@/components/ui/select'
import { useIntl } from 'react-intl'
import type { Sprint, SprintStatus } from '@prisma/client'
import { cn } from '@/lib/utils'
import {
  deriveSprintState,
  groupSprintsForTaskField,
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

const ITEM_CLS =
  'relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50'

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
  const { sprints: drafts, isLoading: draftsLoading } = useSprintsForTeam(
    task.teamId,
    'DRAFT'
  )
  const { sprints: active, isLoading: activeLoading } = useSprintsForTeam(
    task.teamId,
    'ACTIVE'
  )

  const { activeAndUpcoming, past } = useMemo(
    () => groupSprintsForTaskField([...(active ?? []), ...(drafts ?? [])]),
    [active, drafts]
  )

  const disabled = task.sprint?.status === 'CLOSED'
  const value = task.sprintId ?? 'none'

  // Trigger label: prefer the loaded sprint, fall back to the SSR-prefetched
  // name so the name shows on first paint instead of flickering blank until
  // `useSprintsForTeam` loads. See LUM-189.
  const loaded = task.sprintId
    ? [...activeAndUpcoming, ...past].find(s => s.id === task.sprintId)
    : undefined
  const triggerName =
    loaded?.name ?? (task.sprintId ? (task.sprint?.name ?? null) : null)
  const noSprintLabel = intl.formatMessage({ id: 'sprints.taskField.noSprint' })

  // 兜底防抖 (LUM-191): if a bound sprint's name can't be resolved yet — neither
  // the loaded option nor the SSR-prefetched fallback (LUM-189) — and the
  // option list is still loading, reserve the space with a skeleton instead of
  // showing the "no sprint" placeholder and then popping the name in. Only fires
  // when no name is available, so it never hides an already-resolvable name.
  if (
    (draftsLoading || activeLoading) &&
    task.sprintId !== null &&
    triggerName === null
  ) {
    return <FieldValueSkeleton />
  }

  const renderItem = (s: Sprint) => {
    const state = deriveSprintState(s)
    const Icon = STATUS_ICON[state]
    return (
      // Use the Radix primitive directly so only `s.name` lives inside
      // `ItemText` — the trigger then displays the bare sprint name without
      // the icon / date / status row, while the dropdown still renders the
      // full row. Wrapping a node tree containing siblings in `<SelectValue>`
      // children breaks under React 19 (portal/ref ambiguity).
      <SelectPrimitive.Item key={s.id} value={s.id} className={ITEM_CLS}>
        <span className='absolute right-2 flex h-3.5 w-3.5 items-center justify-center'>
          <SelectPrimitive.ItemIndicator>
            <Check className='h-4 w-4' />
          </SelectPrimitive.ItemIndicator>
        </span>
        <span className='flex w-full items-center gap-3'>
          <Icon className={cn('size-3.5 shrink-0', STATUS_ICON_CLS[state])} />
          <span className='flex-1 truncate'>
            <SelectPrimitive.ItemText>{s.name}</SelectPrimitive.ItemText>
          </span>
          <span className='w-32 shrink-0 text-right text-xs tabular-nums text-muted-foreground'>
            {formatCompactRange(s, intl.locale)}
          </span>
          <span className='w-16 shrink-0 text-xs text-muted-foreground/80'>
            {intl.formatMessage({ id: STATUS_LABEL_KEY[state] })}
          </span>
        </span>
      </SelectPrimitive.Item>
    )
  }

  return (
    <Select
      value={value}
      onValueChange={v => onChange(v === 'none' ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className={cn(triggerClassName)}>
        {triggerName ? (
          <span className='truncate'>{triggerName}</span>
        ) : (
          <span className='text-muted-foreground'>{noSprintLabel}</span>
        )}
      </SelectTrigger>
      <SelectContent className='min-w-[18rem]'>
        <SelectItem value='none'>{noSprintLabel}</SelectItem>
        {activeAndUpcoming.map(renderItem)}
        {past.length > 0 && activeAndUpcoming.length > 0 && <SelectSeparator />}
        {past.map(renderItem)}
      </SelectContent>
    </Select>
  )
}
