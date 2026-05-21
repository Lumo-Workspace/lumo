'use client'

import { Eye } from 'lucide-react'
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
import type { WorkspaceMemberInfo } from '../../types'
import { MemberAvatar } from './shared'

export interface OwnerSelectProps {
  value: string | null
  onChange: (v: string | null) => void
  members: (WorkspaceMemberInfo & { actorId: string })[]
  /** The project-level owner ID — used to show "inherited" state */
  inheritedId?: string | null
  triggerClassName?: string
  /** Text shown in the trigger and dropdown when no value is selected. */
  unassignedLabel?: string
  /** Tooltip text shown on hover of the trigger. */
  tooltipText?: string
}

export function OwnerSelect({
  value,
  onChange,
  members,
  inheritedId,
  triggerClassName,
  unassignedLabel = 'No owner',
  tooltipText = 'Owner — notified about project changes',
}: OwnerSelectProps) {
  const owner = members.find(m => m.actorId === value)
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
            {owner ? (
              <div className='flex items-center gap-1.5'>
                <MemberAvatar member={owner} size='xs' />
                <span>{owner.name}</span>
              </div>
            ) : inherited ? (
              <div className='flex items-center gap-1.5 text-zinc-400'>
                <MemberAvatar member={inherited} size='xs' />
                <span className='italic'>{inherited.name}</span>
              </div>
            ) : (
              <div className='flex items-center gap-1.5 text-zinc-400'>
                <Eye size={14} />
                <span>{unassignedLabel}</span>
              </div>
            )}
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
      <SelectContent>
        <SelectItem value='__unassigned__'>
          <div className='flex items-center gap-2'>
            <Eye size={14} className='text-zinc-400 shrink-0' />
            <span className='text-zinc-400'>{unassignedLabel}</span>
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
