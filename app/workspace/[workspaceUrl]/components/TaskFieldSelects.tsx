'use client'

import {
  UserCircle2,
  Eye,
  BatteryWarning,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  Bot,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { StatusIcon } from './StatusIcon'
import {
  ApiProject,
  ApiPriority,
  ApiStatus,
  WorkspaceMemberInfo,
} from '../types'
import { API_STATUS_LABEL } from '../utils'

// ─── Priority config ───────────────────────────────────────────────────────────

export const PRIORITY_CONFIG: Record<
  ApiPriority,
  {
    label: string
    Icon: React.ComponentType<{ className?: string }>
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

export function SeparatorDot() {
  return <span className='text-zinc-200 dark:text-zinc-700 select-none'>·</span>
}

/** Shared trigger class for all inline task-field selects */
export const FIELD_TRIGGER_CLS =
  'h-7 text-xs border-none shadow-none bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 px-2 w-auto gap-1.5 focus:ring-0 rounded-md'

export function getInitials(name: string) {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function PriorityIcon({ priority }: { priority: ApiPriority }) {
  const { Icon, iconColor } =
    PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG.MEDIUM
  return (
    <span className={iconColor}>
      <Icon className='size-4' />
    </span>
  )
}

// ─── MemberAvatar ─────────────────────────────────────────────────────────────

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

// ─── StatusSelect ─────────────────────────────────────────────────────────────

export function StatusSelect({
  value,
  onChange,
  triggerClassName,
}: {
  value: ApiStatus
  onChange: (v: ApiStatus) => void
  triggerClassName?: string
}) {
  return (
    <Select value={value} onValueChange={v => onChange(v as ApiStatus)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger className={triggerClassName}>
            <div className='flex items-center gap-1.5'>
              <StatusIcon status={value} />
              <span>{API_STATUS_LABEL[value]}</span>
            </div>
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>Status</TooltipContent>
      </Tooltip>
      <SelectContent>
        {(Object.entries(API_STATUS_LABEL) as [ApiStatus, string][]).map(
          ([val, label]) => (
            <SelectItem key={val} value={val}>
              <div className='flex items-center gap-2'>
                <StatusIcon status={val} />
                {label}
              </div>
            </SelectItem>
          )
        )}
      </SelectContent>
    </Select>
  )
}

// ─── AssigneeSelect ───────────────────────────────────────────────────────────

export function AssigneeSelect({
  value,
  onChange,
  members,
  isAgent,
  onAgentSelect,
  triggerClassName,
}: {
  value: string | null
  onChange: (v: string | null) => void
  members: WorkspaceMemberInfo[]
  /** True when assigneeType === 'agent' */
  isAgent?: boolean
  /** Called when user picks the Agent option */
  onAgentSelect?: () => void
  triggerClassName?: string
}) {
  const assignee = !isAgent ? members.find(m => m.id === value) : null
  return (
    <Select
      value={isAgent ? '__agent__' : (value ?? '__unassigned__')}
      onValueChange={v => {
        if (v === '__agent__') {
          onAgentSelect?.()
        } else {
          onChange(v === '__unassigned__' ? null : v)
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger className={triggerClassName}>
            {isAgent ? (
              <div className='flex items-center gap-1.5 text-violet-500'>
                <Bot size={14} />
                <span>Agent</span>
              </div>
            ) : assignee ? (
              <div className='flex items-center gap-1.5'>
                <MemberAvatar member={assignee} size='xs' />
                <span>{assignee.name}</span>
              </div>
            ) : (
              <div className='flex items-center gap-1.5 text-zinc-400'>
                <UserCircle2 size={16} />
                <span>No assignee</span>
              </div>
            )}
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>Assignee</TooltipContent>
      </Tooltip>
      <SelectContent>
        <SelectItem value='__unassigned__'>
          <div className='flex items-center gap-2'>
            <UserCircle2 size={16} className='text-zinc-400 shrink-0' />
            <span className='text-zinc-400'>No assignee</span>
          </div>
        </SelectItem>
        {onAgentSelect && (
          <SelectItem value='__agent__'>
            <div className='flex items-center gap-2'>
              <Bot size={14} className='text-violet-500 shrink-0' />
              <span className='text-violet-500'>Agent</span>
            </div>
          </SelectItem>
        )}
        {members.map(m => (
          <SelectItem key={m.id} value={m.id}>
            <div className='flex items-center gap-2'>
              <MemberAvatar member={m} size='xs' />
              {m.name}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ─── ReviewerSelect ───────────────────────────────────────────────────────────

export function ReviewerSelect({
  value,
  onChange,
  members,
  inheritedId,
  triggerClassName,
}: {
  value: string | null
  onChange: (v: string | null) => void
  members: WorkspaceMemberInfo[]
  /** The project-level default reviewer ID — used to show "inherited" state */
  inheritedId?: string | null
  triggerClassName?: string
}) {
  const reviewer = members.find(m => m.id === value)
  const inherited =
    !value && inheritedId ? members.find(m => m.id === inheritedId) : null

  return (
    <Select
      value={value ?? '__unassigned__'}
      onValueChange={v => onChange(v === '__unassigned__' ? null : v)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger className={triggerClassName}>
            {reviewer ? (
              <div className='flex items-center gap-1.5'>
                <MemberAvatar member={reviewer} size='xs' />
                <span>{reviewer.name}</span>
              </div>
            ) : inherited ? (
              <div className='flex items-center gap-1.5 text-zinc-400'>
                <MemberAvatar member={inherited} size='xs' />
                <span className='italic'>{inherited.name}</span>
              </div>
            ) : (
              <div className='flex items-center gap-1.5 text-zinc-400'>
                <Eye size={14} />
                <span>No reviewer</span>
              </div>
            )}
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>
          Reviewer — notified when task moves to In Review
        </TooltipContent>
      </Tooltip>
      <SelectContent>
        <SelectItem value='__unassigned__'>
          <div className='flex items-center gap-2'>
            <Eye size={14} className='text-zinc-400 shrink-0' />
            <span className='text-zinc-400'>No reviewer</span>
          </div>
        </SelectItem>
        {members.map(m => (
          <SelectItem key={m.id} value={m.id}>
            <div className='flex items-center gap-2'>
              <MemberAvatar member={m} size='xs' />
              {m.name}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ─── PrioritySelect ───────────────────────────────────────────────────────────

export function PrioritySelect({
  value,
  onChange,
  triggerClassName,
}: {
  value: ApiPriority
  onChange: (v: ApiPriority) => void
  triggerClassName?: string
}) {
  const { label } = PRIORITY_CONFIG[value] ?? PRIORITY_CONFIG.MEDIUM
  return (
    <Select value={value} onValueChange={v => onChange(v as ApiPriority)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger className={triggerClassName}>
            <div className='flex items-center gap-1.5'>
              <PriorityIcon priority={value} />
              <span>{label}</span>
            </div>
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>Priority</TooltipContent>
      </Tooltip>
      <SelectContent>
        {(
          Object.entries(PRIORITY_CONFIG) as [
            ApiPriority,
            (typeof PRIORITY_CONFIG)[ApiPriority],
          ][]
        ).map(([val, { label: lbl, Icon, iconColor }]) => (
          <SelectItem key={val} value={val}>
            <div className='flex items-center gap-2'>
              <span className={iconColor}>
                <Icon className='size-4' />
              </span>
              {lbl}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ─── ProjectSelect ────────────────────────────────────────────────────────────

export function ProjectSelect({
  value,
  onChange,
  projects,
  placeholder = 'Select project',
  triggerClassName,
}: {
  value: string
  onChange: (v: string) => void
  projects: ApiProject[]
  placeholder?: string
  triggerClassName?: string
}) {
  const project = projects.find(p => p.id === value)
  return (
    <Select value={value} onValueChange={onChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger className={triggerClassName}>
            {project ? (
              <span>{project.name}</span>
            ) : (
              <span className='text-zinc-400'>{placeholder}</span>
            )}
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>Project</TooltipContent>
      </Tooltip>
      <SelectContent>
        {projects.length === 0 ? (
          <SelectItem value='__empty__' disabled>
            No projects
          </SelectItem>
        ) : (
          projects.map(p => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  )
}
