'use client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { Bot } from 'lucide-react'
import type { WorkspaceMemberInfo } from '../../types'

interface ActorMentionProps {
  name: string
  imageUrl?: string | undefined
  isAgent?: boolean
  email?: string | null
  role?: string | null
}

export function ActorMention({
  name,
  imageUrl,
  isAgent,
  email,
  role,
}: ActorMentionProps) {
  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span className='inline-flex items-center text-zinc-800 dark:text-zinc-200 font-medium cursor-pointer hover:underline'>
          @{name}
        </span>
      </HoverCardTrigger>
      <HoverCardContent className='w-56 p-3' side='top'>
        <div className='flex gap-2.5'>
          {isAgent ? (
            <div className='size-8 shrink-0 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center'>
              <Bot className='size-4 text-violet-600 dark:text-violet-400' />
            </div>
          ) : (
            <Avatar className='size-8 shrink-0'>
              <AvatarImage src={imageUrl} />
              <AvatarFallback className='text-[10px]'>
                {initials}
              </AvatarFallback>
            </Avatar>
          )}
          <div className='min-w-0'>
            <span className='block text-body-strong text-zinc-900 dark:text-zinc-100 truncate'>
              {name}
            </span>
            {isAgent && (
              <span className='block text-caption text-violet-600 dark:text-violet-400'>
                Agent
              </span>
            )}
            {email && (
              <span className='block text-caption text-zinc-500 dark:text-zinc-400 truncate'>
                {email}
              </span>
            )}
            {role && !isAgent && (
              <span className='block text-caption text-zinc-500 dark:text-zinc-400 capitalize'>
                {role.toLowerCase()}
              </span>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

/** Build an ActorMention element from an actorId using members/agentActors lists. */
export function buildActorMention(
  actorId: unknown,
  members: WorkspaceMemberInfo[],
  agentActors: { actorId: string; name: string }[]
): React.ReactNode | null {
  if (typeof actorId !== 'string' || !actorId) return null
  const member = members.find(m => m.actorId === actorId)
  if (member) {
    return (
      <ActorMention
        name={member.name}
        imageUrl={member.imageUrl ?? undefined}
        email={member.email}
        role={member.role}
      />
    )
  }
  const agent = agentActors.find(a => a.actorId === actorId)
  if (agent) {
    return <ActorMention name={agent.name} isAgent />
  }
  return null
}
