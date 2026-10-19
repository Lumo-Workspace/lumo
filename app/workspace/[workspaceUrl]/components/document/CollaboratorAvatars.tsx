'use client'

import {
  AVATAR_SIZE_CLASS,
  MemberAvatar,
  type AvatarSize,
} from '@/components/MemberAvatar'
import { cn } from '@/lib/utils'

interface Editor {
  member: { id: string; name: string; imageUrl: string | null }
  lastEditedAt: string
}

interface CollaboratorAvatarsProps {
  editors: Editor[]
  max?: number
  size?: AvatarSize
}

/** Overlapping stack of document editors; a background-coloured border separates the circles. */
export function CollaboratorAvatars({
  editors,
  max = 3,
  size = 'xs',
}: CollaboratorAvatarsProps) {
  if (editors.length === 0) return null
  const visible = editors.slice(0, max)
  const overflow = editors.length - max

  return (
    <div
      className='flex items-center'
      title={editors.map(e => e.member.name).join(', ')}
    >
      {visible.map((editor, i) => (
        <MemberAvatar
          key={editor.member.id}
          name={editor.member.name}
          imageUrl={editor.member.imageUrl}
          size={size}
          className={cn('border-2 border-background', i > 0 && '-ml-1.5')}
          style={{ zIndex: visible.length - i }}
        />
      ))}
      {overflow > 0 && (
        <div
          className={cn(
            AVATAR_SIZE_CLASS[size],
            '-ml-1.5 flex shrink-0 items-center justify-center rounded-full border-2 border-background bg-muted'
          )}
        >
          <span className='text-caption text-muted-foreground'>
            +{overflow}
          </span>
        </div>
      )}
    </div>
  )
}
