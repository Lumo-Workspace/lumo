'use client'

import { SlidersHorizontal, Check, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import {
  COMPLETED_FILTER_LABELS,
  type CompletedFilter,
} from '../utils/filterCompletedTasks'
import {
  ORDERING_LABELS,
  ORDERING_OPTIONS,
  type TaskOrdering,
} from '../utils/sortTasks'
import { Switch } from '@/components/ui/switch'

const FILTER_OPTIONS: CompletedFilter[] = [
  'all',
  'past_day',
  'past_week',
  'past_month',
  'none',
]

const ORDERING_TOOLTIPS: Record<TaskOrdering, string> = {
  manual: 'Sort by your custom order, drag to reorder',
  title: 'Sort alphabetically by task title',
  priority: 'Sort by priority level (Urgent first)',
  assignee: 'Sort alphabetically by assignee name',
  created: 'Sort by creation date (newest first)',
  updated: 'Sort by last updated date (newest first)',
}

const COMPLETED_FILTER_TOOLTIPS: Record<CompletedFilter, string> = {
  all: 'Show all completed tasks',
  past_day: 'Only show tasks completed in the past 24 hours',
  past_week: 'Only show tasks completed in the past 7 days',
  past_month: 'Only show tasks completed in the past 30 days',
  none: 'Hide all completed tasks',
}

interface DisplayOptionsMenuProps {
  completedFilter: CompletedFilter
  onCompletedFilterChange: (value: CompletedFilter) => void
  ordering: TaskOrdering
  onOrderingChange: (value: TaskOrdering) => void
  showSubtasks: boolean
  onShowSubtasksChange: (value: boolean) => void
}

export function DisplayOptionsMenu({
  completedFilter,
  onCompletedFilterChange,
  ordering,
  onOrderingChange,
  showSubtasks,
  onShowSubtasksChange,
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
        <div className='flex items-center gap-1 px-2 py-1.5'>
          <p className='text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider'>
            Ordering
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info
                size={12}
                className='text-zinc-400 dark:text-zinc-500 cursor-help'
              />
            </TooltipTrigger>
            <TooltipContent side='top'>
              Choose how tasks are sorted in the list view
            </TooltipContent>
          </Tooltip>
        </div>
        {ORDERING_OPTIONS.map(opt => (
          <Tooltip key={opt}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onOrderingChange(opt)}
                className='flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors'
              >
                <span className='text-zinc-700 dark:text-zinc-300'>
                  {ORDERING_LABELS[opt]}
                </span>
                {ordering === opt && (
                  <Check
                    size={14}
                    className='text-zinc-500 dark:text-zinc-400'
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side='left'>
              {ORDERING_TOOLTIPS[opt]}
            </TooltipContent>
          </Tooltip>
        ))}

        <div className='my-1.5 border-t border-zinc-100 dark:border-zinc-800' />

        <div className='flex items-center gap-1 px-2 py-1.5'>
          <p className='text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider'>
            Completed issues
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info
                size={12}
                className='text-zinc-400 dark:text-zinc-500 cursor-help'
              />
            </TooltipTrigger>
            <TooltipContent side='top'>
              Filter which completed tasks are visible
            </TooltipContent>
          </Tooltip>
        </div>
        {FILTER_OPTIONS.map(opt => (
          <Tooltip key={opt}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onCompletedFilterChange(opt)}
                className='flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors'
              >
                <span className='text-zinc-700 dark:text-zinc-300'>
                  {COMPLETED_FILTER_LABELS[opt]}
                </span>
                {completedFilter === opt && (
                  <Check
                    size={14}
                    className='text-zinc-500 dark:text-zinc-400'
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side='left'>
              {COMPLETED_FILTER_TOOLTIPS[opt]}
            </TooltipContent>
          </Tooltip>
        ))}

        <div className='my-1.5 border-t border-zinc-100 dark:border-zinc-800' />

        <div className='flex items-center gap-1 px-2 py-1.5'>
          <p className='text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider'>
            Subtasks
          </p>
        </div>
        <label className='flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer'>
          <span className='text-zinc-700 dark:text-zinc-300'>
            Show subtasks
          </span>
          <Switch
            checked={showSubtasks}
            onCheckedChange={onShowSubtasksChange}
          />
        </label>
      </PopoverContent>
    </Popover>
  )
}
