'use client'

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useState,
} from 'react'
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
    // Stable per-instance prefix so aria-activedescendant can reference the
    // active option's id (the editor keeps DOM focus; this is a virtual listbox).
    const baseId = useId()
    const optionId = (index: number) => `${baseId}-opt-${index}`

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
        <div className='px-3 py-2 text-xs text-muted-foreground'>
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
          ? 'bg-muted'
          : 'hover:bg-muted'
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
            id={optionId(flatIndex)}
            type='button'
            role='option'
            aria-selected={isSelected}
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
            <span className='text-foreground truncate'>
              {item.label}
            </span>
          </button>
        )
      }

      return (
        <button
          key={`task-${item.id}`}
          id={optionId(flatIndex)}
          type='button'
          role='option'
          aria-selected={isSelected}
          onMouseDown={e => e.preventDefault()}
          onClick={() => selectItem(flatIndex)}
          onMouseEnter={() => setSelectedIndex(flatIndex)}
          className={rowCls}
        >
          <StatusIcon status={item.status} size={14} />
          <span className='text-xs text-muted-foreground shrink-0 font-medium'>
            {item.label}
          </span>
          <span className='text-foreground truncate'>
            {item.title}
          </span>
        </button>
      )
    }

    return (
      <div
        className='py-1'
        role='listbox'
        aria-label={intl.formatMessage({ id: 'mention.label' })}
        aria-activedescendant={optionId(selectedIndex)}
      >
        {users.length > 0 && (
          <div
            role='group'
            aria-label={intl.formatMessage({ id: 'mention.users' })}
          >
            <div className='px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
              {intl.formatMessage({ id: 'mention.users' })}
            </div>
            {users.map((item, i) => renderItem(item, userOffset + i))}
          </div>
        )}
        {tasks.length > 0 && (
          <div
            role='group'
            aria-label={intl.formatMessage({ id: 'mention.tasks' })}
          >
            <div
              className={cn(
                'px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground',
                users.length > 0 &&
                  'mt-1 border-t border-border pt-2'
              )}
            >
              {intl.formatMessage({ id: 'mention.tasks' })}
            </div>
            {tasks.map((item, i) => renderItem(item, taskOffset + i))}
          </div>
        )}
      </div>
    )
  }
)
MentionList.displayName = 'MentionList'
