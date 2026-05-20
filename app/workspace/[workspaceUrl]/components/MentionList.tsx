'use client'

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { useIntl } from 'react-intl'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
// Bot icon removed — agent features disabled for now
import { StatusIcon } from './StatusIcon'
import { cn } from '@/lib/utils'

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export type MentionItem =
  | {
      type: 'user'
      id: string
      label: string
      imageUrl: string | null
    }
  | {
      type: 'task'
      id: string
      label: string // e.g. "SPE-24"
      title: string
      status: string
    }
// agent mention type hidden — agent features disabled for now

interface MentionListProps {
  items: MentionItem[]
  command: (attrs: {
    id: string
    label: string
    mentionType: string
    mentionTitle?: string
    mentionStatus?: string
  }) => void
}

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, command }, ref) => {
    const intl = useIntl()
    const [selectedIndex, setSelectedIndex] = useState(0)

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    const selectItem = (index: number) => {
      const item = items[index]
      if (!item) return
      if (item.type === 'task') {
        command({
          id: item.id,
          label: item.label,
          mentionType: 'task',
          mentionTitle: item.title,
          mentionStatus: item.status,
        })
      } else {
        command({ id: item.id, label: item.label, mentionType: 'user' })
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
        <div className='px-3 py-2 text-xs text-zinc-400'>
          {intl.formatMessage({ id: 'mention.empty' })}
        </div>
      )
    }

    const users = items.filter(i => i.type === 'user')
    const tasks = items.filter(i => i.type === 'task')
    const userOffset = 0
    const taskOffset = users.length

    const renderItem = (item: MentionItem, flatIndex: number) => {
      const isSelected = flatIndex === selectedIndex
      const rowCls = cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
        isSelected
          ? 'bg-zinc-100 dark:bg-zinc-800'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
      )

      if (item.type === 'user') {
        const initials = item.label
          .split(' ')
          .map(w => w[0])
          .join('')
          .toUpperCase()
          .slice(0, 2)
        return (
          <button
            key={`user-${item.id}`}
            type='button'
            onPointerDown={e => {
              e.preventDefault()
              selectItem(flatIndex)
            }}
            onMouseEnter={() => setSelectedIndex(flatIndex)}
            className={rowCls}
          >
            <Avatar className='size-5 shrink-0'>
              <AvatarImage src={item.imageUrl ?? undefined} />
              <AvatarFallback className='text-[10px]'>
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className='text-zinc-800 dark:text-zinc-200 truncate'>
              {item.label}
            </span>
          </button>
        )
      }

      return (
        <button
          key={`task-${item.id}`}
          type='button'
          onMouseDown={e => e.preventDefault()}
          onClick={() => selectItem(flatIndex)}
          onMouseEnter={() => setSelectedIndex(flatIndex)}
          className={rowCls}
        >
          <StatusIcon status={item.status} size={14} />
          <span className='text-xs text-zinc-400 shrink-0 font-medium'>
            {item.label}
          </span>
          <span className='text-zinc-800 dark:text-zinc-200 truncate'>
            {item.title}
          </span>
        </button>
      )
    }

    return (
      <div className='py-1'>
        {users.length > 0 && (
          <>
            <div className='px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400'>
              {intl.formatMessage({ id: 'mention.users' })}
            </div>
            {users.map((item, i) => renderItem(item, userOffset + i))}
          </>
        )}
        {tasks.length > 0 && (
          <>
            <div
              className={cn(
                'px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400',
                users.length > 0 &&
                  'mt-1 border-t border-zinc-100 dark:border-zinc-800 pt-2'
              )}
            >
              {intl.formatMessage({ id: 'mention.tasks' })}
            </div>
            {tasks.map((item, i) => renderItem(item, taskOffset + i))}
          </>
        )}
      </div>
    )
  }
)
MentionList.displayName = 'MentionList'
