'use client'

import type { ComponentProps } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { getInitials } from '@/lib/utils/getInitials'
import { cn } from '@/lib/utils'
import type { ApiPriority, WorkspaceMemberInfo } from '../../types'

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
}

/** react-intl message ids for priority labels (LUM-263). `label` above stays
 *  the English fallback consumed by the inline selects. */
export const PRIORITY_LABEL_ID: Record<ApiPriority, string> = {
  URGENT: 'priority.urgent',
  HIGH: 'priority.high',
  MEDIUM: 'priority.medium',
  LOW: 'priority.low',
}

/** Shared trigger class for all inline task-field selects */
export const FIELD_TRIGGER_CLS =
  'h-7 text-caption border-none shadow-none bg-transparent hover:bg-muted px-2 w-auto gap-1.5 focus:ring-0 rounded-md'

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
 * Extra props are spread onto the span so a `TooltipTrigger asChild` can hand
 * it a ref and its aria wiring.
 */
export function PriorityDot({
  priority,
  className,
  ...props
}: { priority: ApiPriority } & ComponentProps<'span'>) {
  const { iconColor } = PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.MEDIUM
  return (
    <span
      data-testid={`priority-dot-${priority.toLowerCase()}`}
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full bg-current',
        iconColor,
        className
      )}
      {...props}
    />
  )
}

// ─── MemberAvatar ──────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-status-in-review-subtle text-status-in-review-text',
  'bg-info-subtle text-info-text',
  'bg-success-subtle text-success-text',
  'bg-warning-subtle text-warning-text',
  'bg-danger-subtle text-danger-text',
]

function memberColor(name: string) {
  const code = name.charCodeAt(0) + (name.charCodeAt(1) ?? 0)
  return AVATAR_COLORS[code % AVATAR_COLORS.length]
}

export function MemberAvatar({
  member,
}: {
  member: WorkspaceMemberInfo
  /** Kept for call-site compatibility: both sizes render at size-5 since
   *  12px caption initials don't fit a 16px circle (LUM-1244). */
  size?: 'sm' | 'xs'
}) {
  return (
    <Avatar className='size-5 shrink-0'>
      <AvatarImage src={member.imageUrl ?? undefined} alt={member.name} />
      <AvatarFallback
        className={`${memberColor(member.name)} text-caption font-semibold`}
      >
        {getInitials(member.name)}
      </AvatarFallback>
    </Avatar>
  )
}
