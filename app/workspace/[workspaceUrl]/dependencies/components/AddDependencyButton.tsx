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
} from '@/components/ui/command'
import { StatusIcon } from '../../components/StatusIcon'
import { useTaskMentionSearch } from '../../hooks/useTaskMentionSearch'
import { relationToEdge, type Relation } from '../relation'

interface AddDependencyButtonProps {
  /** Excludes the current task from results. */
  currentIdentifier: string
  /** "<relation>:<identifier>" keys of CONFIRMED edges — greys the exact pair that would 409. */
  existingRelations: Set<string>
  onAdd: (data: {
    blockedBy: string
    direction: 'BLOCKED_BY' | 'BLOCKS'
    kind: 'BLOCKS' | 'RELATES'
  }) => void
  busy?: boolean
}

const RELATIONS: Relation[] = ['BLOCKED_BY', 'BLOCKS', 'RELATES']
const RELATION_LABEL: Record<Relation, string> = {
  BLOCKED_BY: 'task.dependencies.blockedBy',
  BLOCKS: 'task.dependencies.blocks',
  RELATES: 'task.dependencies.kindRelates',
}

export function AddDependencyButton({
  currentIdentifier,
  existingRelations,
  onAdd,
  busy,
}: AddDependencyButtonProps) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [relation, setRelation] = useState<Relation>('BLOCKED_BY')
  const { results: items, loading } = useTaskMentionSearch(
    query,
    currentIdentifier,
    open
  )

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setQuery('')
      setRelation('BLOCKED_BY')
    }
  }

  const trimmed = query.trim()
  const hintId = !trimmed
    ? 'task.dependencies.searchHint'
    : loading
      ? 'task.dependencies.searching'
      : items.length === 0
        ? 'task.dependencies.noResults'
        : null

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type='button'
          disabled={busy}
          className='text-body text-muted-foreground hover:text-foreground inline-flex items-center gap-1'
        >
          <Plus className='h-3.5 w-3.5' />
          {intl.formatMessage({ id: 'task.dependencies.addDependency' })}
        </button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-80 p-2'>
        <div role='radiogroup' className='flex gap-1 mb-2 text-caption'>
          {RELATIONS.map(r => (
            <button
              key={r}
              type='button'
              role='radio'
              aria-checked={relation === r}
              onClick={() => setRelation(r)}
              className={`px-2 py-0.5 rounded-md border ${relation === r ? 'border-foreground' : 'border-border text-muted-foreground'}`}
            >
              {intl.formatMessage({ id: RELATION_LABEL[r] })}
            </button>
          ))}
        </div>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={intl.formatMessage({
              id: 'task.dependencies.searchPlaceholder',
            })}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {hintId && (
              <p className='py-3 px-2 text-caption text-muted-foreground'>
                {intl.formatMessage({ id: hintId })}
              </p>
            )}
            {trimmed &&
              !loading &&
              items.map(item => {
                const already = existingRelations.has(
                  `${relation}:${item.label}`
                )
                return (
                  <CommandItem
                    key={item.id}
                    value={item.label}
                    disabled={already}
                    onSelect={() => {
                      if (already) return
                      onAdd({
                        blockedBy: item.label,
                        ...relationToEdge(relation),
                      })
                      setOpen(false)
                    }}
                  >
                    {item.status && (
                      <span className='mr-1.5 shrink-0'>
                        <StatusIcon status={item.status} size={12} />
                      </span>
                    )}
                    <span className='font-mono text-caption mr-2 text-muted-foreground'>
                      {item.label}
                    </span>
                    <span className='truncate'>{item.sublabel}</span>
                    {already && (
                      <span className='ml-auto text-caption text-muted-foreground'>
                        {intl.formatMessage({ id: 'task.dependencies.added' })}
                      </span>
                    )}
                  </CommandItem>
                )
              })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
