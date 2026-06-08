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
import { ListChecks, Layers, FolderKanban, Flag } from 'lucide-react'
import { StatusIcon } from './StatusIcon'
import { cn } from '@/lib/utils'
import type { MentionItem, MentionKind } from '@/types/mention'

export type { MentionItem } from '@/types/mention'

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface MentionListProps {
  items: MentionItem[]
  loading?: boolean
  command: (attrs: {
    id: string
    label: string
    mentionType: string
    mentionTitle?: string
    mentionStatus?: string
    mentionHref?: string
  }) => void
}

const GROUP_ORDER: { kind: MentionKind; labelId: string }[] = [
  { kind: 'user', labelId: 'mention.users' },
  { kind: 'task', labelId: 'mention.tasks' },
  { kind: 'sprint', labelId: 'mention.sprints' },
  { kind: 'project', labelId: 'mention.projects' },
  { kind: 'milestone', labelId: 'mention.milestones' },
]

function EntityGlyph({
  kind,
  status,
}: {
  kind: MentionKind
  status?: string | undefined
}) {
  if (kind === 'task') return <StatusIcon status={status ?? 'TODO'} size={14} />
  if (kind === 'sprint')
    return <Layers size={14} className='text-muted-foreground' />
  if (kind === 'project')
    return <FolderKanban size={14} className='text-muted-foreground' />
  if (kind === 'milestone')
    return <Flag size={14} className='text-muted-foreground' />
  return <ListChecks size={14} className='text-muted-foreground' />
}

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, loading = false, command }, ref) => {
    const intl = useIntl()
    const [selectedIndex, setSelectedIndex] = useState(0)
    const baseId = useId()
    const optionId = (index: number) => `${baseId}-opt-${index}`

    useEffect(() => {
      setSelectedIndex(0)
    }, [items])

    const selectItem = (index: number) => {
      const item = items[index]
      if (!item) return
      if (item.kind === 'user') {
        command({ id: item.id, label: item.label, mentionType: 'user' })
        return
      }
      command({
        id: item.id,
        label: item.label,
        mentionType: item.kind,
        ...(item.kind === 'task' && item.sublabel
          ? { mentionTitle: item.sublabel }
          : {}),
        ...(item.status ? { mentionStatus: item.status } : {}),
        mentionHref: item.href,
      })
    }

    useImperativeHandle(ref, () => ({
      onKeyDown({ event }) {
        if (!items.length) return false
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
          {loading
            ? intl.formatMessage({ id: 'mention.searching' })
            : intl.formatMessage({ id: 'mention.empty' })}
        </div>
      )
    }

    const renderRow = (item: MentionItem, flatIndex: number) => {
      const isSelected = flatIndex === selectedIndex
      const rowCls = cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
        isSelected ? 'bg-muted' : 'hover:bg-muted'
      )
      const common = {
        id: optionId(flatIndex),
        type: 'button' as const,
        role: 'option' as const,
        'aria-selected': isSelected,
        onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
        onClick: () => selectItem(flatIndex),
        onMouseEnter: () => setSelectedIndex(flatIndex),
        className: rowCls,
      }

      if (item.kind === 'user') {
        const initials = item.label
          .split(' ')
          .map(w => w[0])
          .join('')
          .toUpperCase()
          .slice(0, 2)
        return (
          <button key={`user-${item.id}`} {...common}>
            <Avatar className='size-5 shrink-0'>
              <AvatarImage src={item.imageUrl ?? undefined} />
              <AvatarFallback className='text-[10px]'>
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className='text-foreground truncate'>{item.label}</span>
          </button>
        )
      }

      return (
        <button key={`${item.kind}-${item.id}`} {...common}>
          <EntityGlyph kind={item.kind} status={item.status} />
          <span className='text-xs text-muted-foreground shrink-0 font-medium'>
            {item.label}
          </span>
          {item.sublabel && (
            <span className='text-foreground truncate'>{item.sublabel}</span>
          )}
        </button>
      )
    }

    let cursor = 0
    return (
      <div
        className='py-1'
        role='listbox'
        aria-label={intl.formatMessage({ id: 'mention.label' })}
        aria-activedescendant={optionId(selectedIndex)}
      >
        {GROUP_ORDER.map(({ kind, labelId }, groupIdx) => {
          const groupItems = items.filter(i => i.kind === kind)
          if (!groupItems.length) return null
          const offset = cursor
          cursor += groupItems.length
          return (
            <div
              key={kind}
              role='group'
              aria-label={intl.formatMessage({ id: labelId })}
            >
              <div
                className={cn(
                  'px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground',
                  groupIdx > 0 &&
                    offset > 0 &&
                    'mt-1 border-t border-border pt-2'
                )}
              >
                {intl.formatMessage({ id: labelId })}
              </div>
              {groupItems.map((item, i) => renderRow(item, offset + i))}
            </div>
          )
        })}
        {loading && (
          <div className='px-3 py-1.5 text-xs text-muted-foreground'>
            {intl.formatMessage({ id: 'mention.searching' })}
          </div>
        )}
      </div>
    )
  }
)
MentionList.displayName = 'MentionList'
