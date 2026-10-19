'use client'

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { MemberAvatar } from '../fields'
import type { WorkspaceMemberInfo } from '../../types'

/**
 * LUM-1012 · a workspace member the way the rest of the app shows one: avatar
 * + name, with the same hover card as the board's assignee avatar (bigger
 * avatar, name, email, role). Pure render.
 */
export function MemberHoverChip({ member }: { member: WorkspaceMemberInfo }) {
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span
          data-testid='member-chip'
          tabIndex={0}
          className='inline-flex cursor-default items-center gap-1.5 rounded-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring'
        >
          <MemberAvatar
            name={member.name}
            imageUrl={member.imageUrl}
            size='xs'
          />
          <span>{member.name}</span>
        </span>
      </HoverCardTrigger>
      <HoverCardContent side='top' align='start' className='w-60 p-3'>
        <div className='flex items-center gap-3'>
          <MemberAvatar
            name={member.name}
            imageUrl={member.imageUrl}
            size='lg'
          />
          <div className='flex min-w-0 flex-col'>
            <span className='truncate text-body-strong text-foreground'>
              {member.name}
            </span>
            {member.email ? (
              <span className='truncate text-caption text-muted-foreground'>
                {member.email}
              </span>
            ) : null}
            <span className='text-caption capitalize text-muted-foreground'>
              {member.role.toLowerCase()}
            </span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
