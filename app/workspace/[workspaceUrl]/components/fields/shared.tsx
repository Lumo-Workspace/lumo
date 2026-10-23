'use client'

import type { ComponentProps } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { ApiPriority } from '../../types'

// ─── Priority config ───────────────────────────────────────────────────────────

export const PRIORITY_CONFIG: Record<
  ApiPriority,
  {
    label: string
    iconColor: string
  }
> = {
  URGENT: {
    label: 'Urgent',
    iconColor: 'text-priority-urgent',
  },
  HIGH: {
    label: 'High',
    iconColor: 'text-priority-high',
  },
  MEDIUM: {
    label: 'Medium',
    iconColor: 'text-priority-medium',
  },
  LOW: {
    label: 'Low',
    iconColor: 'text-priority-low',
  },
  // LUM-1284: not assessed. Listed last (it sorts after LOW) and drawn as a
  // hollow dashed ring in the muted foreground, so it reads as "no priority"
  // rather than as a fifth level.
  NONE: {
    label: 'No priority',
    iconColor: 'text-muted-foreground',
  },
}

/** react-intl message ids for priority labels (LUM-263). `label` above stays
 *  the English fallback consumed by the inline selects. */
export const PRIORITY_LABEL_ID: Record<ApiPriority, string> = {
  URGENT: 'priority.urgent',
  HIGH: 'priority.high',
  MEDIUM: 'priority.medium',
  LOW: 'priority.low',
  NONE: 'priority.none',
}

/** Shared trigger class for all inline task-field selects */
export const FIELD_TRIGGER_CLS =
  'h-7 text-caption border-none shadow-none bg-transparent hover:bg-muted px-2 w-auto gap-1.5 focus:ring-0 rounded-md'

/**
 * LUM-1274: how an inline task-field select draws its trigger. `default` keeps
 * the caller-styled trigger (`triggerClassName`); `ghost` is the borderless
 * control-sm row that reads as text until hovered (the task detail panel).
 */
export type FieldVariant = 'default' | 'ghost'

/** SelectTrigger variant/size props for a field variant. */
export function fieldTriggerProps(variant: FieldVariant = 'default') {
  return variant === 'ghost'
    ? ({ variant: 'ghost', size: 'sm' } as const)
    : ({ variant: 'default', size: 'default' } as const)
}

// ─── FieldValueSkeleton ──────────────────────────────────────────────────────────

/**
 * Placeholder shown while an inline field's option list is still loading and a
 * bound value's name can't be resolved yet. Matches the field trigger's `h-7`
 * height and `px-2` padding so swapping it for the real `<Select>` causes no
 * vertical shift, and reserves a fixed width so the resolved name doesn't pop
 * the layout sideways (LUM-191 兜底防抖). `widthClassName` lets callers tune the
 * reserved width to the field's typical value length.
 */
export function FieldValueSkeleton({
  widthClassName = 'w-20',
}: {
  widthClassName?: string
}) {
  return (
    <div className='flex h-7 items-center px-2' aria-hidden='true'>
      <Skeleton className={cn('h-3.5 rounded-sm', widthClassName)} />
    </div>
  )
}

// ─── SeparatorDot ──────────────────────────────────────────────────────────────

export function SeparatorDot() {
  return <span className='text-muted-foreground select-none'>·</span>
}

// ─── PriorityDot ───────────────────────────────────────────────────────────────

/**
 * The single markup source for the priority disc (LUM-702). Every surface that
 * shows a task's priority renders this — board cards, table cells, selects,
 * bulk pickers, the activity timeline and the Signal tab — so the size and the
 * `--priority-*` colour can never drift between them.
 * `bg-current` paints the disc from the same token class the label text uses.
 * `size-3` (12px) matches the drawn diameter of the default 14px StatusIcon
 * (ring r≈5.5 + 1.5 stroke, DONE disc r≈6), so the two sit level side by side.
 * Extra props are spread onto the span so a `TooltipTrigger asChild` can hand
 * it a ref and its aria wiring.
 */
export function PriorityDot({
  priority,
  className,
  ...props
}: { priority: ApiPriority } & ComponentProps<'span'>) {
  const config = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.NONE
  const unassessed = config === PRIORITY_CONFIG.NONE
  return (
    <span
      data-testid={`priority-dot-${priority.toLowerCase()}`}
      className={cn(
        'inline-block size-3 shrink-0 rounded-full',
        unassessed ? 'border border-dashed border-current' : 'bg-current',
        config.iconColor,
        className
      )}
      {...props}
    />
  )
}

// ─── MemberAvatar ──────────────────────────────────────────────────────────────

/** Re-exported so field pickers keep importing it from here (LUM-1269). */
export { MemberAvatar } from '@/components/MemberAvatar'
