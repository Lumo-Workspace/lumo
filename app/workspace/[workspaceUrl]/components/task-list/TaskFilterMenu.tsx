'use client'

import { useState } from 'react'
import { Check, ChevronLeft, ChevronRight, ListFilter } from 'lucide-react'
import { useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { WorkspaceMemberInfo } from '../../types'
import { useFilterLabels } from '../../hooks/useFilterLabels'
import {
  countActiveFilters,
  dimensionValueCounts,
  narrowableDimensions,
  type FilterableTask,
  type FilterDimension,
  type TaskFilters,
} from '../../utils/filterTasks'

interface TaskFilterMenuProps {
  /** The scope's tasks *before* filtering — the option values are read off these. */
  tasks: FilterableTask[]
  filters: TaskFilters
  members: WorkspaceMemberInfo[]
  /**
   * Stable clock (from `useNow`) so due-date bucketing stays render-pure.
   * `null` until mount — the due-date dimension is withheld until it arrives.
   */
  now: number | null
  onToggleValue: (dimension: FilterDimension, value: string) => void
}

/**
 * The Filter entry point: a two-level popover — pick a dimension, then pick one
 * or more values in it. Selections land as removable chips beside the toolbar
 * ({@link TaskFilterChips}); this control only writes them.
 *
 * Only dimensions that can actually narrow the current scope are offered, so
 * the same component serves a single-project board and a cross-project sprint
 * without any per-scope configuration.
 */
export function TaskFilterMenu({
  tasks,
  filters,
  members,
  now,
  onToggleValue,
}: TaskFilterMenuProps) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const [dimension, setDimension] = useState<FilterDimension | null>(null)
  const { dimensionLabel, valueLabel } = useFilterLabels(tasks, members)

  const dimensions = narrowableDimensions(tasks, filters, now)
  const activeCount = countActiveFilters(filters)

  const triggerLabel = intl.formatMessage({
    id: 'filter.menuTrigger',
    defaultMessage: 'Filter',
  })

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next)
        // Always reopen on the dimension list — a stale sub-menu is disorienting.
        if (!next) setDimension(null)
      }}
    >
      <PopoverTrigger asChild>
        {/* Icon-only, matching the Display trigger beside it (LUM-721) — the
            label survives as tooltip/aria copy. The count badge is the only
            visible text, so an active filter is never silent. */}
        <Button
          variant='ghost'
          size='sm'
          title={triggerLabel}
          aria-label={triggerLabel}
          className='h-8 w-auto min-w-8 gap-1 px-1.5 text-muted-foreground hover:text-foreground'
        >
          <ListFilter size={14} />
          {activeCount > 0 && (
            <span className='min-w-4 rounded-sm bg-muted px-1 text-caption text-foreground'>
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-56 p-2'>
        {dimensions.length === 0 ? (
          <p className='px-2 py-1.5 text-body text-muted-foreground'>
            {intl.formatMessage({
              id: 'filter.noFields',
              defaultMessage: 'Nothing to filter on here yet',
            })}
          </p>
        ) : dimension === null ? (
          dimensions.map(dim => (
            <button
              key={dim}
              type='button'
              onClick={() => setDimension(dim)}
              className='flex items-center justify-between w-full px-2 py-1.5 text-body rounded-md hover:bg-muted transition-colors'
            >
              <span className='text-foreground'>{dimensionLabel(dim)}</span>
              <span className='flex items-center gap-1 text-muted-foreground'>
                {(filters[dim]?.length ?? 0) > 0 && (
                  <span className='text-caption'>{filters[dim]?.length}</span>
                )}
                <ChevronRight size={14} />
              </span>
            </button>
          ))
        ) : (
          <>
            <button
              type='button'
              onClick={() => setDimension(null)}
              className='flex items-center gap-1 w-full px-2 py-1.5 rounded-md hover:bg-muted transition-colors'
            >
              <ChevronLeft size={12} className='text-muted-foreground' />
              <span className='text-caption text-muted-foreground uppercase'>
                {dimensionLabel(dimension)}
              </span>
            </button>
            <div className='my-1.5 border-t border-border' />
            {dimensionValueCounts(tasks, dimension, now).map(option => {
              const selected =
                filters[dimension]?.includes(option.value) ?? false
              return (
                <button
                  key={option.value}
                  type='button'
                  onClick={() => onToggleValue(dimension, option.value)}
                  className='flex items-center justify-between gap-2 w-full px-2 py-1.5 text-body rounded-md hover:bg-muted transition-colors'
                >
                  <span className='text-foreground truncate'>
                    {valueLabel(dimension, option.value)}
                  </span>
                  <span className='flex items-center gap-1.5 shrink-0 text-muted-foreground'>
                    <span className='text-caption'>{option.count}</span>
                    {selected && <Check size={14} />}
                  </span>
                </button>
              )
            })}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
