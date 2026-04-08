'use client'

import type { ComponentType } from 'react'
import {
  BatteryWarning,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getInitials } from '@/lib/utils/getInitials'
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
    iconColor: 'text-red-500',
  },
  HIGH: {
    label: 'High',
    Icon: BatteryLow,
    iconColor: 'text-orange-500',
  },
  MEDIUM: {
    label: 'Medium',
    Icon: BatteryMedium,
    iconColor: 'text-yellow-500',
  },
  LOW: {
    label: 'Low',
    Icon: BatteryFull,
    iconColor: 'text-zinc-400',
  },
}

/** Shared trigger class for all inline task-field selects */
export const FIELD_TRIGGER_CLS =
  'h-7 text-xs border-none shadow-none bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 px-2 w-auto gap-1.5 focus:ring-0 rounded-md'

// ─── SeparatorDot ──────────────────────────────────────────────────────────────

export function SeparatorDot() {
  return <span className='text-zinc-200 dark:text-zinc-700 select-none'>·</span>
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
