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
        <span className='inline-flex items-center text-foreground cursor-pointer hover:underline'>
          @{name}
        </span>
      </HoverCardTrigger>
      <HoverCardContent className='w-56 p-3' side='top'>
        <div className='flex gap-2.5'>
          {isAgent ? (
            <div className='size-8 shrink-0 rounded-full bg-info-subtle flex items-center justify-center'>
              <Bot className='size-4 text-info-text' />
            </div>
          ) : (
            <Avatar className='size-8 shrink-0'>
              <AvatarImage src={imageUrl} />
              <AvatarFallback className='text-caption'>
                {initials}
              </AvatarFallback>
            </Avatar>
          )}
          <div className='min-w-0'>
            <span className='block text-body-strong text-foreground truncate'>
              {name}
            </span>
            {isAgent && (
              <span className='block text-caption text-info-text'>Agent</span>
            )}
            {email && (
              <span className='block text-caption text-muted-foreground truncate'>
                {email}
              </span>
            )}
            {role && !isAgent && (
              <span className='block text-caption text-muted-foreground capitalize'>
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
