'use client'

import { useMemo, useState } from 'react'
import { getInitials } from '@/lib/utils/getInitials'
import {
  UserCircle2,
  Eye,
  BatteryWarning,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  Bot,
  CalendarDays,
  X,
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
import { useIntl } from 'react-intl'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { StatusIcon } from './StatusIcon'
import {
  ApiProject,
  ApiPriority,
  ApiStatus,
  WorkspaceMemberInfo,
} from '../types'
import { API_STATUS_LABEL, formatDueDate, isOverdue } from '../utils'
import { cn } from '@/lib/utils'

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
  agentActors,
  assignee,
  triggerClassName,
}: {
  value: string | null // Actor.id
  onChange: (v: string | null) => void
  members: (WorkspaceMemberInfo & { actorId: string })[]
  agentActors?:
    | { actorId: string; name: string; avatarColor: string }[]
    | undefined
  /** Current assignee from task detail — used as fallback when agentActors hasn't loaded */
  assignee?: { type: 'HUMAN' | 'AGENT'; agent?: { name: string } | null } | null
  triggerClassName?: string
}) {
  const assigneeMember = members.find(m => m.actorId === value)
  // Merge agentActors list with a fallback entry from the task's assignee
  // so the dropdown always shows the current agent even before agentActors loads
  const allAgents = useMemo(() => {
    const list = agentActors ?? []
    if (
      value &&
      assignee?.type === 'AGENT' &&
      !list.some(a => a.actorId === value)
    ) {
      return [
        ...list,
        {
          actorId: value,
          name: assignee.agent?.name ?? 'Coding Agent',
          avatarColor: '#6366f1',
        },
      ]
    }
    return list
  }, [agentActors, value, assignee])
  const resolvedAgent = allAgents.find(a => a.actorId === value)
  return (
    <Select
      value={value ?? '__unassigned__'}
      onValueChange={v => onChange(v === '__unassigned__' ? null : v)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger className={triggerClassName}>
            {resolvedAgent ? (
              <div className='flex items-center gap-1.5 text-violet-500'>
                <Bot size={14} />
                <span>{resolvedAgent.name}</span>
              </div>
            ) : assigneeMember ? (
              <div className='flex items-center gap-1.5'>
                <MemberAvatar member={assigneeMember} size='xs' />
                <span>{assigneeMember.name}</span>
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
        {allAgents.map(a => (
          <SelectItem key={a.actorId} value={a.actorId}>
            <div className='flex items-center gap-2'>
              <Bot size={14} className='text-violet-500 shrink-0' />
              <span className='text-violet-500'>{a.name}</span>
            </div>
          </SelectItem>
        ))}
        {members
          .filter(m => m.actorId)
          .map(m => (
            <SelectItem key={m.actorId} value={m.actorId}>
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
  members: (WorkspaceMemberInfo & { actorId: string })[]
  /** The project-level default reviewer ID — used to show "inherited" state */
  inheritedId?: string | null
  triggerClassName?: string
}) {
  const reviewer = members.find(m => m.actorId === value)
  const inherited =
    !value && inheritedId ? members.find(m => m.actorId === inheritedId) : null

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
        {members
          .filter(m => m.actorId)
          .map(m => (
            <SelectItem key={m.actorId} value={m.actorId}>
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

// ─── DueDatePicker ───────────────────────────────────────────────────────────

export function DueDatePicker({
  value,
  onChange,
  triggerClassName,
}: {
  value: string | null
  onChange: (v: string | null) => void
  triggerClassName?: string
}) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogDate, setDialogDate] = useState<Date | undefined>(undefined)
  const [dialogMonth, setDialogMonth] = useState<Date>(new Date())
  const [dateInput, setDateInput] = useState('')

  const overdue = isOverdue(value)
  const displayText = formatDueDate(value)

  function toDateOnly(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  }

  function pickDate(date: Date) {
    onChange(toDateOnly(date).toISOString())
    setOpen(false)
  }

  function computeQuickDate(
    offset: 'today' | 'tomorrow' | 'endOfWeek' | 'inOneWeek'
  ): Date {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    switch (offset) {
      case 'today':
        break
      case 'tomorrow':
        d.setDate(d.getDate() + 1)
        break
      case 'endOfWeek': {
        const day = d.getDay() // 0=Sun
        const diff = day === 0 ? 5 : 5 - day // nearest Friday
        d.setDate(d.getDate() + (diff <= 0 ? 7 + diff : diff))
        break
      }
      case 'inOneWeek':
        d.setDate(d.getDate() + 7)
        break
    }
    return d
  }

  function formatShortDate(d: Date): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]
    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`
  }

  function formatDateInput(d: Date): string {
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${mm}/${dd}/${d.getFullYear()}`
  }

  function parseDateInput(s: string): Date | null {
    const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (!match) return null
    const [, mm, dd, yyyy] = match
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
    if (isNaN(d.getTime())) return null
    return d
  }

  function openDialog() {
    setOpen(false)
    const initial = value ? new Date(value) : new Date()
    setDialogDate(initial)
    setDialogMonth(new Date(initial.getFullYear(), initial.getMonth(), 1))
    setDateInput(formatDateInput(initial))
    setDialogOpen(true)
  }

  function handleDialogSave() {
    if (dialogDate) {
      onChange(toDateOnly(dialogDate).toISOString())
    }
    setDialogOpen(false)
  }

  function handleDialogRemove() {
    onChange(null)
    setDialogOpen(false)
  }

  function handleDateInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setDateInput(val)
    const parsed = parseDateInput(val)
    if (parsed) {
      setDialogDate(parsed)
      setDialogMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1))
    }
  }

  function setDialogPreset(daysFromNow: number) {
    const d = new Date()
    d.setDate(d.getDate() + daysFromNow)
    d.setHours(0, 0, 0, 0)
    setDialogDate(d)
    setDialogMonth(new Date(d.getFullYear(), d.getMonth(), 1))
    setDateInput(formatDateInput(d))
  }

  const quickOptions = [
    { key: 'today' as const, msgId: 'dueDate.today' },
    { key: 'tomorrow' as const, msgId: 'dueDate.tomorrow' },
    { key: 'endOfWeek' as const, msgId: 'dueDate.endOfWeek' },
    { key: 'inOneWeek' as const, msgId: 'dueDate.inOneWeek' },
  ]

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type='button'
                className={cn(
                  triggerClassName,
                  'inline-flex items-center gap-1.5',
                  overdue && 'text-red-500'
                )}
              >
                <CalendarDays className='size-3.5 shrink-0' />
                {displayText && <span>{displayText}</span>}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {intl.formatMessage({ id: 'dueDate.label' })}
          </TooltipContent>
        </Tooltip>
        <PopoverContent className='w-auto p-0' align='start'>
          <div className='flex flex-col py-1'>
            {value && (
              <>
                <button
                  type='button'
                  className='flex items-center gap-2 px-3 py-1.5 text-xs text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors'
                  onClick={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                >
                  <X className='size-3' />
                  {intl.formatMessage({ id: 'dueDate.removeDueDate' })}
                </button>
                <div className='border-b border-zinc-200 dark:border-zinc-800 my-0.5' />
              </>
            )}
            <button
              type='button'
              className='flex items-center justify-between px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors'
              onClick={openDialog}
            >
              <span className='flex items-center gap-2'>
                <CalendarDays className='size-3' />
                {intl.formatMessage({ id: 'dueDate.custom' })}
              </span>
            </button>
            <div className='border-b border-zinc-200 dark:border-zinc-800 my-0.5' />
            {quickOptions.map(({ key, msgId }) => {
              const d = computeQuickDate(key)
              return (
                <button
                  key={key}
                  type='button'
                  className='flex items-center justify-between px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors'
                  onClick={() => pickDate(d)}
                >
                  <span>{intl.formatMessage({ id: msgId })}</span>
                  <span className='text-muted-foreground ml-4'>
                    {formatShortDate(d)}
                  </span>
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>

      {/* Custom date picker dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className='max-w-fit'>
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: 'dueDate.editTitle' })}
            </DialogTitle>
            <DialogDescription>
              {intl.formatMessage({ id: 'dueDate.editDescription' })}
            </DialogDescription>
          </DialogHeader>
          <div>
            <input
              type='text'
              value={dateInput}
              onChange={handleDateInputChange}
              placeholder='MM/DD/YYYY'
              className='w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'
            />
          </div>
          <Calendar
            mode='single'
            className='p-0 [--cell-size:--spacing(9.5)]'
            selected={dialogDate}
            onSelect={day => {
              if (day) {
                setDialogDate(day)
                setDialogMonth(new Date(day.getFullYear(), day.getMonth(), 1))
                setDateInput(formatDateInput(day))
              }
            }}
            month={dialogMonth}
            onMonthChange={setDialogMonth}
            fixedWeeks
          />
          <div className='flex flex-wrap gap-2 border-t border-zinc-200 dark:border-zinc-800 pt-3'>
            {quickOptions.map(({ key, msgId }) => {
              const days =
                key === 'today'
                  ? 0
                  : key === 'tomorrow'
                    ? 1
                    : key === 'endOfWeek'
                      ? (() => {
                          const day = new Date().getDay()
                          const diff = day === 0 ? 5 : 5 - day
                          return diff <= 0 ? 7 + diff : diff
                        })()
                      : 7
              return (
                <Button
                  key={key}
                  variant='outline'
                  size='sm'
                  className='flex-1'
                  onClick={() => setDialogPreset(days)}
                >
                  {intl.formatMessage({ id: msgId })}
                </Button>
              )
            })}
          </div>
          <DialogFooter className='sm:justify-between'>
            <Button
              variant='ghost'
              size='sm'
              className='text-red-500 hover:text-red-600'
              onClick={handleDialogRemove}
            >
              {intl.formatMessage({ id: 'dueDate.removeDueDate' })}
            </Button>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setDialogOpen(false)}
              >
                {intl.formatMessage({ id: 'dueDate.cancel' })}
              </Button>
              <Button size='sm' onClick={handleDialogSave}>
                {intl.formatMessage({ id: 'dueDate.save' })}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
