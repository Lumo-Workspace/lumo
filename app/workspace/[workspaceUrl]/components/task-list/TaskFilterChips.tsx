'use client'

import { X } from 'lucide-react'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'
import type { WorkspaceMemberInfo } from '../../types'
import { useFilterLabels } from '../../hooks/useFilterLabels'
import {
  activeFilterDimensions,
  type FilterableTask,
  type FilterDimension,
  type TaskFilters,
} from '../../utils/filterTasks'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface TaskFilterChipsProps {
  /** The scope's tasks *before* filtering — chip value labels are read off these. */
  tasks: FilterableTask[]
  filters: TaskFilters
  members: WorkspaceMemberInfo[]
  onClearDimension: (dimension: FilterDimension) => void
  onClearAll: () => void
  /**
   * `row` (default) is its own padded row under the toolbar; `inline` drops the
   * page gutter so the chips can sit inside a toolbar slot.
   */
  layout?: 'row' | 'inline'
}

/**
 * The active-filter chips row: one chip per filtered dimension, each removable
 * on its own, plus a clear-all. Renders `null` when nothing is filtered, so the
 * row only occupies space while it has something to say — the toolbar above it
 * keeps its fixed height either way.
 */
export function TaskFilterChips({
  tasks,
  filters,
  members,
  onClearDimension,
  onClearAll,
  layout = 'row',
}: TaskFilterChipsProps) {
  const intl = useIntl()
  const { dimensionLabel, valueLabel } = useFilterLabels(tasks, members)
  const dimensions = activeFilterDimensions(filters)

  if (dimensions.length === 0) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1.5',
        layout === 'row' && 'px-4 pb-2 md:px-8'
      )}
    >
      {dimensions.map(dimension => {
        const values = filters[dimension] ?? []
        const shown = valueLabel(dimension, values[0] as string)
        const extra = values.length - 1
        const removeLabel = intl.formatMessage(
          {
            id: 'filter.chip.remove',
            defaultMessage: 'Remove {dimension} filter',
          },
          { dimension: dimensionLabel(dimension) }
        )
        return (
          <span
            key={dimension}
            className='flex items-center gap-1 h-7 pl-2 pr-1 rounded-md border border-border bg-card text-caption'
          >
            <span className='text-muted-foreground'>
              {dimensionLabel(dimension)}
            </span>
            <span className='text-foreground truncate max-w-40'>
              {extra > 0
                ? intl.formatMessage(
                    {
                      id: 'filter.chip.valueWithMore',
                      defaultMessage: '{value} +{count}',
                    },
                    { value: shown, count: extra }
                  )
                : shown}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type='button'
                  onClick={() => onClearDimension(dimension)}
                  aria-label={removeLabel}
                  className='flex items-center justify-center size-5 rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
                >
                  <X size={12} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{removeLabel}</TooltipContent>
            </Tooltip>
          </span>
        )
      })}
      <button
        type='button'
        onClick={onClearAll}
        className='h-7 px-2 rounded-md text-caption text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
      >
        {intl.formatMessage({
          id: 'filter.clearAll',
          defaultMessage: 'Clear all',
        })}
      </button>
    </div>
  )
}
