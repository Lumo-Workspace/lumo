'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { FieldValueSkeleton } from '../fields'
import { useMilestones } from '../../hooks/useMilestones'
import { useFormatDate } from '../../hooks/useFormatDate'

interface Props {
  projectId: string
  value: string | null
  onChange: (milestoneId: string | null) => void
  triggerClassName?: string
  /**
   * SSR-prefetched name of the currently-bound milestone. Lets the trigger
   * render the correct name on first paint instead of flickering blank until
   * the client option list (`useMilestones`) loads. See LUM-189.
   */
  milestone?: { id: string; name: string } | null
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
  milestone,
}: Props) {
  const intl = useIntl()
  const { fmtDate } = useFormatDate()
  // Defer the option-list fetch until the dropdown is first opened. The
  // trigger name comes from the SSR-prefetched `milestone` prop (LUM-189), so
  // first paint needs no client request. Sticky once opened so re-opens are
  // instant. See LUM-190.
  const [hasOpened, setHasOpened] = useState(false)
  const { milestones, loading } = useMilestones(projectId, 'active', hasOpened)

  // LUM-714: the old `status !== 'CANCELLED'` filter has no successor to
  // apply — a cancelled milestone is an archived one now, and the `'active'`
  // fetch above already excludes archived. Completed milestones stay
  // selectable, exactly as before (binding a task simply reopens them).
  const selectable = milestones

  // Trigger label: prefer the loaded option (carries targetDate), fall back to
  // the SSR-prefetched name so the name shows on first paint, else placeholder.
  const loaded = value ? milestones.find(m => m.id === value) : undefined
  const triggerName = loaded?.name ?? (value ? (milestone?.name ?? null) : null)

  // 兜底防抖 (LUM-191): if a bound milestone's name can't be resolved yet —
  // neither the loaded option nor the SSR-prefetched fallback (LUM-189) — and
  // the option list is still loading, reserve the space with a skeleton instead
  // of showing the placeholder and then popping the name in. Only fires when no
  // name is available, so it never hides an already-resolvable name.
  if (loading && value !== null && triggerName === null) {
    return <FieldValueSkeleton />
  }

  return (
    <Select
      value={value ?? NONE_VALUE}
      onValueChange={v => onChange(v === NONE_VALUE ? null : v)}
      onOpenChange={open => {
        if (open) setHasOpened(true)
      }}
    >
      <SelectTrigger className={cn('max-w-full', triggerClassName)}>
        {triggerName ? (
          <span className='min-w-0 truncate'>
            {triggerName}
            {loaded?.targetDate
              ? ` · ${fmtDate(loaded.targetDate, DATE_OPTS)}`
              : ''}
          </span>
        ) : (
          <span className='text-muted-foreground'>
            {intl.formatMessage({ id: 'task.field.milestone' })}
          </span>
        )}
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
