'use client'

import { useMemo } from 'react'
import { UserCircle2, Bot } from 'lucide-react'
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

export interface AssigneeSelectProps {
  value: string | null // Actor.id
  onChange: (v: string | null) => void
  members: (WorkspaceMemberInfo & { actorId: string })[]
  agentActors?:
    | { actorId: string; name: string; avatarColor: string }[]
    | undefined
  /** Current assignee from task detail — used as fallback when agentActors hasn't loaded */
  assignee?: { type: 'HUMAN' | 'AGENT'; agent?: { name: string } | null } | null
  triggerClassName?: string
}

export function AssigneeSelect({
  value,
  onChange,
  members,
  agentActors,
  assignee,
  triggerClassName,
}: AssigneeSelectProps) {
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
