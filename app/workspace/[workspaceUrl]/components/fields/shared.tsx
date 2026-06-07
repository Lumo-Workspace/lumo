'use client'

import type { ComponentType } from 'react'
import {
  BatteryWarning,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
} from 'lucide-react'
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
    Icon: ComponentType<{ className?: string }>
    iconColor: string
  }
> = {
  URGENT: {
    label: 'Urgent',
    Icon: BatteryWarning,
    iconColor: 'text-priority-urgent',
  },
  HIGH: {
    label: 'High',
    Icon: BatteryLow,
    iconColor: 'text-priority-high',
  },
  MEDIUM: {
    label: 'Medium',
    Icon: BatteryMedium,
    iconColor: 'text-priority-medium',
  },
  LOW: {
    label: 'Low',
    Icon: BatteryFull,
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
  'h-7 text-xs border-none shadow-none bg-transparent hover:bg-muted px-2 w-auto gap-1.5 focus:ring-0 rounded-md'

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

// ─── PriorityIcon ──────────────────────────────────────────────────────────────

export function PriorityIcon({ priority }: { priority: ApiPriority }) {
  const { Icon, iconColor } =
    PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.MEDIUM
  return (
    <span className={iconColor}>
      <Icon className='size-4' />
    </span>
  )
}

// ─── MemberAvatar ──────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
]

function memberColor(name: string) {
  const code = name.charCodeAt(0) + (name.charCodeAt(1) ?? 0)
  return AVATAR_COLORS[code % AVATAR_COLORS.length]
}

export function MemberAvatar({
  member,
  size = 'sm',
}: {
  member: WorkspaceMemberInfo
  size?: 'sm' | 'xs'
}) {
  const dim = size === 'xs' ? 'size-4' : 'size-5'
  const textSize = size === 'xs' ? 'text-[9px]' : 'text-[10px]'
  return (
    <Avatar className={`${dim} shrink-0`}>
      <AvatarImage src={member.imageUrl ?? undefined} alt={member.name} />
      <AvatarFallback
        className={`${memberColor(member.name)} ${textSize} font-semibold`}
      >
        {getInitials(member.name)}
      </AvatarFallback>
    </Avatar>
  )
}
