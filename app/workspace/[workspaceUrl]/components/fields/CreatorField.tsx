'use client'

import { useIntl } from 'react-intl'
import { UserCircle2 } from 'lucide-react'
import { MemberAvatar } from './shared'
import type { CreatorDisplay } from './creator-display'

// The ghost select trigger's box (transparent 1px border, px-2, control-sm
// height, body text), so the creator's avatar and name line up with the
// Assignee row above it.
const ROW_CLS =
  'flex h-control-sm items-center gap-1.5 border border-transparent px-2 text-body'

/**
 * LUM-1283: read-only creator value for the task detail panel. The
 * creator is a recorded fact, not an editable property, so there is no
 * picker; the row lines up with the ghost selects around it.
 */
export function CreatorField({ creator }: { creator: CreatorDisplay }) {
  const intl = useIntl()
  if (creator.kind === 'member') {
    return (
      <div className={ROW_CLS}>
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
    <div className={`${ROW_CLS} text-muted-foreground`}>
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
