'use client'

import { useIntl } from 'react-intl'
import type { MemoryCategory } from '@prisma/client'
import {
  MEMORY_CATEGORIES,
  type MemoryCategoryFilter,
  type MemorySortKey,
} from '@/lib/memory/list-view'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ToggleGroup,
  ToggleGroupItem,
  ToggleGroupItemCount,
} from '@/components/ui/toggle-group'
import { SearchInput } from '../SearchInput'

interface MemoryListToolbarProps {
  query: string
  onQueryChange: (value: string) => void
  sort: MemorySortKey
  onSortChange: (value: MemorySortKey) => void
  category: MemoryCategoryFilter
  onCategoryChange: (value: MemoryCategoryFilter) => void
  /** Counts over the unfiltered list, so a chip's number doesn't move as you filter. */
  counts: Record<MemoryCategory, number>
  total: number
  /** The list is still loading: the chips render without their counts, since a
   *  "0" here would be a claim about the project rather than a pending fetch. */
  pending?: boolean
}

/** The same label ids the card's category dot uses, so both read identically. */
const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  TRAP: 'memory.category.trap',
  DECISION: 'memory.category.decision',
  CONVENTION: 'memory.category.convention',
  PROCEDURAL: 'memory.category.procedural',
}

const SORT_LABEL: Record<MemorySortKey, string> = {
  recent: 'memory.list.sort.recent',
  used: 'memory.list.sort.used',
}

/**
 * Search + sort + category chips above a project's memory list.
 *
 * Two rows, in the order you narrow: a full-width query with the sort control
 * pinned right, then the single-select category tabs underneath. The tabs
 * carry their counts because the count is the reason you'd click one — "31
 * conventions" tells you the pool is worth filtering to.
 *
 * All three are client-side view state (see lib/memory/list-view.ts); nothing
 * here fetches or persists.
 */
export function MemoryListToolbar({
  query,
  onQueryChange,
  sort,
  onSortChange,
  category,
  onCategoryChange,
  counts,
  total,
  pending = false,
}: MemoryListToolbarProps) {
  const intl = useIntl()

  const chips: { key: MemoryCategoryFilter; label: string; count: number }[] = [
    {
      key: 'ALL',
      label: intl.formatMessage({ id: 'memory.list.filter.all' }),
      count: total,
    },
    ...MEMORY_CATEGORIES.map(c => ({
      key: c as MemoryCategoryFilter,
      label: intl.formatMessage({ id: CATEGORY_LABEL[c] }),
      count: counts[c],
    })),
  ]

  return (
    <div className='flex flex-col gap-2.5'>
      <div className='flex items-center gap-2'>
        <SearchInput
          className='min-w-0 flex-1'
          value={query}
          onChange={onQueryChange}
          placeholder={intl.formatMessage({ id: 'memory.list.search' })}
        />
        <Select
          value={sort}
          onValueChange={value => onSortChange(value as MemorySortKey)}
        >
          {/* Fixed width: the two option labels differ in length, and a
              content-sized trigger would resize the row on every change. The
              height is the Select's own h-9 — the same 36px SearchInput's
              Input renders at, so the two controls sit on one line. */}
          <SelectTrigger
            className='w-[168px] shrink-0 text-caption'
            aria-label={intl.formatMessage({ id: 'memory.list.sort.label' })}
            data-testid='memory-sort'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABEL) as MemorySortKey[]).map(key => (
              <SelectItem key={key} value={key} className='text-caption'>
                {intl.formatMessage({ id: SORT_LABEL[key] })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Single-select with no "nothing" state: re-clicking the active chip
          (Radix reports '') keeps the current filter. */}
      <ToggleGroup
        type='single'
        variant='chip'
        value={category}
        onValueChange={value => {
          if (value) onCategoryChange(value as MemoryCategoryFilter)
        }}
        aria-label={intl.formatMessage({ id: 'memory.list.filter.label' })}
        data-testid='memory-category-filter'
      >
        {chips.map(chip => (
          <ToggleGroupItem
            key={chip.key}
            value={chip.key}
            data-testid={`memory-category-chip-${chip.key}`}
          >
            {chip.label}
            {/* The count is secondary to the name — one step quieter,
                never its own chip. */}
            {!pending && (
              <ToggleGroupItemCount>{chip.count}</ToggleGroupItemCount>
            )}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
