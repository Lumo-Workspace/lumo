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
                <MemberAvatar
                  decorative
                  name={owner.name}
                  imageUrl={owner.imageUrl}
                  size='xs'
                />
                <span>{owner.name}</span>
              </div>
            ) : inherited ? (
              <div className='flex items-center gap-1.5 text-muted-foreground'>
                <MemberAvatar
                  decorative
                  name={inherited.name}
                  imageUrl={inherited.imageUrl}
                  size='xs'
                />
                <span className='italic'>{inherited.name}</span>
              </div>
            ) : (
              <div className='flex items-center gap-1.5 text-muted-foreground'>
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
            <Eye size={14} className='text-muted-foreground shrink-0' />
            <span className='text-muted-foreground'>{unassignedLabel}</span>
          </div>
        </SelectItem>
        {members
          .filter(m => m.actorId)
          .map(m => (
            <SelectItem key={m.actorId} value={m.actorId}>
              <div className='flex items-center gap-2'>
                <MemberAvatar
                  decorative
                  name={m.name}
                  imageUrl={m.imageUrl}
                  size='xs'
                />
                {m.name}
              </div>
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}
