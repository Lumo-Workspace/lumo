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

export interface ReviewerSelectProps {
  value: string | null
  onChange: (v: string | null) => void
  members: (WorkspaceMemberInfo & { actorId: string })[]
  /** The project-level default reviewer ID — used to show "inherited" state */
  inheritedId?: string | null
  triggerClassName?: string
}

export function ReviewerSelect({
  value,
  onChange,
  members,
  inheritedId,
  triggerClassName,
}: ReviewerSelectProps) {
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
