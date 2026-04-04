'use client'

import { SlidersHorizontal, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  COMPLETED_FILTER_LABELS,
  type CompletedFilter,
} from '../utils/filterCompletedTasks'
import {
  ORDERING_LABELS,
  ORDERING_OPTIONS,
  type TaskOrdering,
} from '../utils/sortTasks'

const FILTER_OPTIONS: CompletedFilter[] = [
  'all',
  'past_day',
  'past_week',
  'past_month',
  'none',
]

interface DisplayOptionsMenuProps {
  completedFilter: CompletedFilter
  onCompletedFilterChange: (value: CompletedFilter) => void
  ordering: TaskOrdering
  onOrderingChange: (value: TaskOrdering) => void
}

export function DisplayOptionsMenu({
  completedFilter,
  onCompletedFilterChange,
  ordering,
  onOrderingChange,
}: DisplayOptionsMenuProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          size='sm'
          className='h-8 gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
        >
          <SlidersHorizontal size={14} />
          Display
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-56 p-2'>
        <p className='text-[11px] font-medium text-zinc-500 dark:text-zinc-400 px-2 py-1.5 uppercase tracking-wider'>
          Ordering
        </p>
        {ORDERING_OPTIONS.map(opt => (
          <button
            key={opt}
            onClick={() => onOrderingChange(opt)}
            className='flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors'
          >
            <span className='text-zinc-700 dark:text-zinc-300'>
              {ORDERING_LABELS[opt]}
            </span>
            {ordering === opt && (
              <Check size={14} className='text-zinc-500 dark:text-zinc-400' />
            )}
          </button>
        ))}

        <div className='my-1.5 border-t border-zinc-100 dark:border-zinc-800' />

        <p className='text-[11px] font-medium text-zinc-500 dark:text-zinc-400 px-2 py-1.5 uppercase tracking-wider'>
          Completed issues
        </p>
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt}
            onClick={() => onCompletedFilterChange(opt)}
            className='flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors'
          >
            <span className='text-zinc-700 dark:text-zinc-300'>
              {COMPLETED_FILTER_LABELS[opt]}
            </span>
            {completedFilter === opt && (
              <Check size={14} className='text-zinc-500 dark:text-zinc-400' />
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
