'use client'

import { SlidersHorizontal, Check, Info } from 'lucide-react'
import { useIntl } from 'react-intl'
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
import { type CompletedFilter } from '../utils/filterCompletedTasks'
import { ORDERING_OPTIONS, type TaskOrdering } from '../utils/sortTasks'
import { Switch } from '@/components/ui/switch'

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
  const intl = useIntl()

  // Icon-only trigger — the label survives as tooltip/aria copy so the control
  // stays discoverable and screen-reader friendly.
  const triggerLabel = intl.formatMessage({
    id: 'display.menuTrigger',
    defaultMessage: 'Display',
  })

  const orderingLabels: Record<TaskOrdering, string> = {
    manual: intl.formatMessage({
      id: 'display.ordering.manual',
      defaultMessage: 'Manual',
    }),
    title: intl.formatMessage({
      id: 'display.ordering.title',
      defaultMessage: 'Title',
    }),
    priority: intl.formatMessage({
      id: 'display.ordering.priority',
      defaultMessage: 'Priority',
    }),
    assignee: intl.formatMessage({
      id: 'display.ordering.assignee',
      defaultMessage: 'Assignee',
    }),
    created: intl.formatMessage({
      id: 'display.ordering.created',
      defaultMessage: 'Created',
    }),
    updated: intl.formatMessage({
      id: 'display.ordering.updated',
      defaultMessage: 'Updated',
    }),
  }

  const orderingTooltips: Record<TaskOrdering, string> = {
    manual: intl.formatMessage({
      id: 'display.ordering.manualHint',
      defaultMessage: 'Sort by your custom order, drag to reorder',
    }),
    title: intl.formatMessage({
      id: 'display.ordering.titleHint',
      defaultMessage: 'Sort alphabetically by task title',
    }),
    priority: intl.formatMessage({
      id: 'display.ordering.priorityHint',
      defaultMessage: 'Sort by priority level (Urgent first)',
    }),
    assignee: intl.formatMessage({
      id: 'display.ordering.assigneeHint',
      defaultMessage: 'Sort alphabetically by assignee name',
    }),
    created: intl.formatMessage({
      id: 'display.ordering.createdHint',
      defaultMessage: 'Sort by creation date (newest first)',
    }),
    updated: intl.formatMessage({
      id: 'display.ordering.updatedHint',
      defaultMessage: 'Sort by last updated date (newest first)',
    }),
  }

  const completedFilterLabels: Record<CompletedFilter, string> = {
    all: intl.formatMessage({
      id: 'display.completed.all',
      defaultMessage: 'All',
    }),
    past_day: intl.formatMessage({
      id: 'display.completed.pastDay',
      defaultMessage: 'Past day',
    }),
    past_week: intl.formatMessage({
      id: 'display.completed.pastWeek',
      defaultMessage: 'Past week',
    }),
    past_month: intl.formatMessage({
      id: 'display.completed.pastMonth',
      defaultMessage: 'Past month',
    }),
    none: intl.formatMessage({
      id: 'display.completed.none',
      defaultMessage: 'None',
    }),
  }

  const completedFilterTooltips: Record<CompletedFilter, string> = {
    all: intl.formatMessage({
      id: 'display.completed.allHint',
      defaultMessage: 'Show all completed tasks',
    }),
    past_day: intl.formatMessage({
      id: 'display.completed.pastDayHint',
      defaultMessage: 'Only show tasks completed in the past 24 hours',
    }),
    past_week: intl.formatMessage({
      id: 'display.completed.pastWeekHint',
      defaultMessage: 'Only show tasks completed in the past 7 days',
    }),
    past_month: intl.formatMessage({
      id: 'display.completed.pastMonthHint',
      defaultMessage: 'Only show tasks completed in the past 30 days',
    }),
    none: intl.formatMessage({
      id: 'display.completed.noneHint',
      defaultMessage: 'Hide all completed tasks',
    }),
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          size='sm'
          title={triggerLabel}
          aria-label={triggerLabel}
          className='size-8 p-0 text-muted-foreground hover:text-foreground'
        >
          <SlidersHorizontal size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-56 p-2'>
        <div className='flex items-center gap-1 px-2 py-1.5'>
          <p className='text-[11px] font-medium text-muted-foreground uppercase tracking-wider'>
            {intl.formatMessage({
              id: 'display.section.ordering',
              defaultMessage: 'Ordering',
            })}
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info size={12} className='text-muted-foreground cursor-help' />
            </TooltipTrigger>
            <TooltipContent side='top'>
              {intl.formatMessage({
                id: 'display.section.orderingHint',
                defaultMessage: 'Choose how tasks are sorted in the list view',
              })}
            </TooltipContent>
          </Tooltip>
        </div>
        {ORDERING_OPTIONS.map(opt => (
          <Tooltip key={opt}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onOrderingChange(opt)}
                className='flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md hover:bg-muted transition-colors'
              >
                <span className='text-foreground'>{orderingLabels[opt]}</span>
                {ordering === opt && (
                  <Check size={14} className='text-muted-foreground' />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side='left'>{orderingTooltips[opt]}</TooltipContent>
          </Tooltip>
        ))}

        <div className='my-1.5 border-t border-border' />

        <div className='flex items-center gap-1 px-2 py-1.5'>
          <p className='text-[11px] font-medium text-muted-foreground uppercase tracking-wider'>
            {intl.formatMessage({
              id: 'display.section.completed',
              defaultMessage: 'Completed issues',
            })}
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info size={12} className='text-muted-foreground cursor-help' />
            </TooltipTrigger>
            <TooltipContent side='top'>
              {intl.formatMessage({
                id: 'display.section.completedHint',
                defaultMessage: 'Filter which completed tasks are visible',
              })}
            </TooltipContent>
          </Tooltip>
        </div>
        {FILTER_OPTIONS.map(opt => (
          <Tooltip key={opt}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onCompletedFilterChange(opt)}
                className='flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md hover:bg-muted transition-colors'
              >
                <span className='text-foreground'>
                  {completedFilterLabels[opt]}
                </span>
                {completedFilter === opt && (
                  <Check size={14} className='text-muted-foreground' />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side='left'>
              {completedFilterTooltips[opt]}
            </TooltipContent>
          </Tooltip>
        ))}

        <div className='my-1.5 border-t border-border' />

        <div className='flex items-center gap-1 px-2 py-1.5'>
          <p className='text-[11px] font-medium text-muted-foreground uppercase tracking-wider'>
            {intl.formatMessage({
              id: 'display.section.subtasks',
              defaultMessage: 'Subtasks',
            })}
          </p>
        </div>
        <label className='flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-md hover:bg-muted transition-colors cursor-pointer'>
          <span className='text-foreground'>
            {intl.formatMessage({
              id: 'display.showSubtasks',
              defaultMessage: 'Show subtasks',
            })}
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
