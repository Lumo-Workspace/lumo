'use client'

import { useIntl } from 'react-intl'
import { Bot, UserCircle2 } from 'lucide-react'
import { MemberAvatar } from './shared'
import type { CreatorDisplay } from './creator-display'

/**
 * LUM-1283: read-only "Created by" value for the task detail panel. The
 * creator is a recorded fact, not an editable property, so there is no
 * picker; the row lines up with the ghost selects around it.
 */
export function CreatorField({ creator }: { creator: CreatorDisplay }) {
  const intl = useIntl()
  if (creator.kind === 'agent') {
    return (
      <div className='flex h-7 items-center gap-1.5 px-2 text-caption text-info-text'>
        <Bot size={14} aria-hidden />
        <span className='truncate'>{creator.name}</span>
      </div>
    )
  }
  if (creator.kind === 'member') {
    return (
      <div className='flex h-7 items-center gap-1.5 px-2 text-caption'>
        <MemberAvatar
          decorative
          name={creator.name}
          imageUrl={creator.imageUrl}
          size='xs'
        />
        <span className='truncate'>{creator.name}</span>
      </div>
    )
  }
  return (
    <div className='flex h-7 items-center gap-1.5 px-2 text-caption text-muted-foreground'>
      <UserCircle2 size={16} aria-hidden />
      <span className='truncate'>
        {intl.formatMessage({
          id:
            creator.kind === 'former-member'
              ? 'task.createdBy.formerMember'
              : 'task.createdBy.unrecorded',
        })}
      </span>
    </div>
  )
}
