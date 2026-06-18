'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Plus } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandEmpty,
} from '@/components/ui/command'
import { mentionSearchClient } from '@/lib/api-client/mention-search'
import type { MentionSearchItem } from '@/types/mention'

interface AddDependencyButtonProps {
  /** Excludes the current task from results. */
  currentIdentifier: string
  onAdd: (data: {
    blockedBy: string
    direction: 'BLOCKED_BY' | 'BLOCKS'
    kind: 'BLOCKS' | 'RELATES'
  }) => void
  busy?: boolean
}

export function AddDependencyButton({
  currentIdentifier,
  onAdd,
  busy,
}: AddDependencyButtonProps) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<MentionSearchItem[]>([])
  const [direction, setDirection] = useState<'BLOCKED_BY' | 'BLOCKS'>(
    'BLOCKED_BY'
  )
  const [kind, setKind] = useState<'BLOCKS' | 'RELATES'>('BLOCKS')

  async function onSearch(q: string) {
    if (!q.trim()) return setItems([])
    const all = await mentionSearchClient.search(q, 8)
    setItems(
      all.filter(i => i.kind === 'task' && i.label !== currentIdentifier)
    )
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setItems([])
      setDirection('BLOCKED_BY')
      setKind('BLOCKS')
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type='button'
          disabled={busy}
          className='text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1'
        >
          <Plus className='h-3.5 w-3.5' />
          {intl.formatMessage({ id: 'task.dependencies.addDependency' })}
        </button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-80 p-2'>
        <div className='flex gap-1 mb-2 text-xs'>
          {(['BLOCKED_BY', 'BLOCKS'] as const).map(d => (
            <button
              key={d}
              type='button'
              onClick={() => setDirection(d)}
              className={`px-2 py-0.5 rounded-md border ${direction === d ? 'border-foreground' : 'border-border text-muted-foreground'}`}
            >
              {intl.formatMessage({
                id:
                  d === 'BLOCKED_BY'
                    ? 'task.dependencies.blockedBy'
                    : 'task.dependencies.blocks',
              })}
            </button>
          ))}
          <span className='flex-1' />
          {(['BLOCKS', 'RELATES'] as const).map(k => (
            <button
              key={k}
              type='button'
              onClick={() => setKind(k)}
              className={`px-2 py-0.5 rounded-md border ${kind === k ? 'border-foreground' : 'border-border text-muted-foreground'}`}
            >
              {intl.formatMessage({
                id:
                  k === 'BLOCKS'
                    ? 'task.dependencies.kindBlocks'
                    : 'task.dependencies.kindRelates',
              })}
            </button>
          ))}
        </div>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={intl.formatMessage({
              id: 'task.dependencies.searchPlaceholder',
            })}
            onValueChange={onSearch}
          />
          <CommandList>
            <CommandEmpty>
              {intl.formatMessage({ id: 'task.dependencies.noResults' })}
            </CommandEmpty>
            {items.map(item => (
              <CommandItem
                key={item.id}
                value={item.label}
                onSelect={() => {
                  onAdd({ blockedBy: item.label, direction, kind })
                  setOpen(false)
                }}
              >
                <span className='font-mono text-xs mr-2 text-muted-foreground'>
                  {item.label}
                </span>
                <span className='truncate'>{item.sublabel}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
