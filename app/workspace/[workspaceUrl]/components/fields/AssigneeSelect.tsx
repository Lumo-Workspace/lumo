'use client'

import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import { DEFAULT_AGENT_AVATAR_COLOR } from '@/lib/constants/avatar'
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
  const intl = useIntl()
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
          avatarColor: DEFAULT_AGENT_AVATAR_COLOR,
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
              <div className='flex items-center gap-1.5 text-info-text'>
                <Bot size={14} />
                <span>{resolvedAgent.name}</span>
              </div>
            ) : assigneeMember ? (
              <div className='flex items-center gap-1.5'>
                <MemberAvatar
                  name={assigneeMember.name}
                  imageUrl={assigneeMember.imageUrl}
                  size='xs'
                />
                <span>{assigneeMember.name}</span>
              </div>
            ) : (
              <div className='flex items-center gap-1.5 text-muted-foreground'>
                <UserCircle2 size={16} />
                <span>No assignee</span>
              </div>
            )}
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {intl.formatMessage({
            id: 'task.assignee',
            defaultMessage: 'Assignee',
          })}
          :{' '}
          {resolvedAgent
            ? resolvedAgent.name
            : assigneeMember
              ? assigneeMember.name
              : intl.formatMessage({
                  id: 'task.unassigned',
                  defaultMessage: 'Unassigned',
                })}
        </TooltipContent>
      </Tooltip>
      <SelectContent>
        <SelectItem value='__unassigned__'>
          <div className='flex items-center gap-2'>
            <UserCircle2 size={16} className='text-muted-foreground shrink-0' />
            <span className='text-muted-foreground'>No assignee</span>
          </div>
        </SelectItem>
        {/* Agent options hidden — agent features disabled for now */}
        {members
          .filter(m => m.actorId)
          .map(m => (
            <SelectItem key={m.actorId} value={m.actorId}>
              <div className='flex items-center gap-2'>
                <MemberAvatar name={m.name} imageUrl={m.imageUrl} size='xs' />
                {m.name}
              </div>
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}
