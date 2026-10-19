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
  // Icons render at 14px but sit inside a fixed `size-5` (20px) slot so the
  // glyph column lines up with the user Avatar (also `size-5`) — without this
  // the avatar rows are visibly wider/taller than the icon rows.
  const icon =
    kind === 'task' ? (
      <StatusIcon status={status ?? 'TODO'} size={14} />
    ) : kind === 'sprint' ? (
      <Layers size={14} className='text-muted-foreground' />
    ) : kind === 'project' ? (
      <FolderKanban size={14} className='text-muted-foreground' />
    ) : kind === 'milestone' ? (
      <Flag size={14} className='text-muted-foreground' />
    ) : (
      <ListChecks size={14} className='text-muted-foreground' />
    )
  return (
    <span className='flex size-5 shrink-0 items-center justify-center'>
      {icon}
    </span>
  )
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
        <div className='px-2 py-2 text-caption text-muted-foreground'>
          {loading
            ? intl.formatMessage({ id: 'mention.searching' })
            : intl.formatMessage({ id: 'mention.empty' })}
        </div>
      )
    }

    const renderRow = (item: MentionItem, flatIndex: number) => {
      const isSelected = flatIndex === selectedIndex
      // `min-w-0` lets the flex children shrink so `truncate` ellipsizes long
      // titles/names instead of forcing the row wider than the popup (which
      // would trigger a horizontal scrollbar). Selected rows get a subtle
      // inset background + a 2px left accent bar rather than a full-bleed fill.
      const rowCls = cn(
        'relative w-full flex items-center gap-2 rounded-md px-2 py-1.5 min-h-8 text-body text-left min-w-0 transition-colors',
        isSelected
          ? "bg-muted before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-foreground before:content-['']"
          : 'hover:bg-muted'
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
              <AvatarFallback className='text-caption'>
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className='min-w-0 truncate text-foreground'>
              {item.label}
            </span>
          </button>
        )
      }

      // Tasks carry a short identifier label (e.g. "LUM-42") + a long title
      // sublabel: keep the id fixed and truncate the title. Sprints/projects/
      // milestones have no sublabel — their label IS the (possibly long) name,
      // so it must truncate instead of staying fixed-width.
      return (
        <button key={`${item.kind}-${item.id}`} {...common}>
          <EntityGlyph kind={item.kind} status={item.status} />
          {item.sublabel ? (
            <>
              <span className='shrink-0 text-body-strong text-muted-foreground'>
                {item.label}
              </span>
              <span className='min-w-0 truncate text-foreground'>
                {item.sublabel}
              </span>
            </>
          ) : (
            <span className='min-w-0 truncate text-foreground'>
              {item.label}
            </span>
          )}
        </button>
      )
    }

    let cursor = 0
    return (
      <div
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
                  'px-2 pb-1 pt-1.5 text-caption font-semibold uppercase text-muted-foreground/80',
                  groupIdx > 0 &&
                    offset > 0 &&
                    'mt-1 border-t border-border/60 pt-2'
                )}
              >
                {intl.formatMessage({ id: labelId })}
              </div>
              {groupItems.map((item, i) => renderRow(item, offset + i))}
            </div>
          )
        })}
        {loading && (
          <div className='px-2 py-1.5 text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'mention.searching' })}
          </div>
        )}
      </div>
    )
  }
)
MentionList.displayName = 'MentionList'
