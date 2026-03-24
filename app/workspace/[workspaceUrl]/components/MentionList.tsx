'use client'

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { WorkspaceMemberInfo } from '../types'
import { cn } from '@/lib/utils'

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface MentionListProps {
  items: WorkspaceMemberInfo[]
  command: (attrs: { id: string; label: string }) => void
}

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)

    // Reset selection when items change
    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    const selectItem = (index: number) => {
      const item = items[index]
      if (item) {
        command({ id: item.clerkId, label: item.name })
      }
    }

    useImperativeHandle(ref, () => ({
      onKeyDown({ event }) {
        if (event.key === 'ArrowUp') {
          setSelectedIndex(i => (i - 1 + items.length) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelectedIndex(i => (i + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          selectItem(selectedIndex)
          return true
        }
        return false
      },
    }))

    if (!items.length) {
      return (
        <div className='px-3 py-2 text-xs text-zinc-400'>No members found</div>
      )
    }

    return (
      <div className='py-1'>
        {items.map((item, index) => {
          const initials = item.name
            .split(' ')
            .map(w => w[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)
          return (
            <button
              key={item.id}
              type='button'
              onMouseDown={e => {
                e.preventDefault()
                selectItem(index)
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
                index === selectedIndex
                  ? 'bg-zinc-100 dark:bg-zinc-800'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
              )}
            >
              <Avatar className='size-5 shrink-0'>
                <AvatarImage src={item.imageUrl ?? undefined} />
                <AvatarFallback className='text-[10px]'>
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className='text-zinc-800 dark:text-zinc-200 truncate'>
                {item.name}
              </span>
            </button>
          )
        })}
      </div>
    )
  }
)
MentionList.displayName = 'MentionList'
