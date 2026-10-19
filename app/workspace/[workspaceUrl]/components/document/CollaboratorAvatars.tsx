'use client'

import { getInitials } from '@/lib/utils/getInitials'

interface Editor {
  member: { id: string; name: string; imageUrl: string | null }
  lastEditedAt: string
}

interface CollaboratorAvatarsProps {
  editors: Editor[]
  max?: number
  size?: number
}

export function CollaboratorAvatars({
  editors,
  max = 3,
  size = 22,
}: CollaboratorAvatarsProps) {
  if (editors.length === 0) return null
  const visible = editors.slice(0, max)
  const overflow = editors.length - max
  // Two caption-size initials don't fit a small chip (< 24px); show one.
  const initialsLength = size < 24 ? 1 : 2

  return (
    <div
      className='flex items-center'
      title={editors.map(e => e.member.name).join(', ')}
    >
      {visible.map((editor, i) => (
        <div
          key={editor.member.id}
          className='rounded-full border-2 border-background bg-muted flex items-center justify-center overflow-hidden shrink-0'
          style={{
            width: size,
            height: size,
            marginLeft: i > 0 ? -6 : 0,
            zIndex: visible.length - i,
          }}
        >
          {editor.member.imageUrl ? (
            <img
              src={editor.member.imageUrl}
              alt={editor.member.name}
              className='w-full h-full object-cover'
            />
          ) : (
            <span className='text-caption text-muted-foreground'>
              {getInitials(editor.member.name).slice(0, initialsLength)}
            </span>
          )}
        </div>
      ))}
      {overflow > 0 && (
        <div
          className='rounded-full border-2 border-background bg-muted flex items-center justify-center shrink-0'
          style={{
            width: size,
            height: size,
            marginLeft: -6,
            zIndex: 0,
          }}
        >
          <span className='text-caption text-muted-foreground'>
            +{overflow}
          </span>
        </div>
      )}
    </div>
  )
}
