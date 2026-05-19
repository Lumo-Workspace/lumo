'use client'

import { useIntl } from 'react-intl'
import { CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DisplayOptionsMenu } from '../../DisplayOptionsMenu'
import { ViewToggle } from '../../ViewToggle'
import type { CompletedFilter } from '../../../utils/filterCompletedTasks'
import type { TaskOrdering } from '../../../utils/sortTasks'

interface Props {
  /** Sprints exist on at least one team in the workspace — gates the toggle. */
  sprintsAvailable: boolean
  currentSprintOnly: boolean
  onToggleCurrentSprintOnly: () => void
  /** True when the toggle is on but no active sprint exists; shows a hint. */
  noActiveSprint: boolean
  completedFilter: CompletedFilter
  onCompletedFilterChange: (value: CompletedFilter) => void
  ordering: TaskOrdering
  onOrderingChange: (value: TaskOrdering) => void
  showSubtasks: boolean
  onShowSubtasksChange: (value: boolean) => void
  viewMode: 'list' | 'board'
  onViewModeChange: (mode: 'list' | 'board') => void
}

/**
 * Regular My Tasks toolbar: filter chips on the left, display options + view
 * toggle on the right. Sits under the page header, with the bulk action bar
 * conditionally overlaid by the page when the user has tasks selected.
 */
export function MyTasksToolbar({
  sprintsAvailable,
  currentSprintOnly,
  onToggleCurrentSprintOnly,
  noActiveSprint,
  completedFilter,
  onCompletedFilterChange,
  ordering,
  onOrderingChange,
  showSubtasks,
  onShowSubtasksChange,
  viewMode,
  onViewModeChange,
}: Props) {
  const intl = useIntl()
  return (
    <div className='h-12 flex items-center justify-between gap-2 px-4 md:px-8'>
      <div className='flex items-center gap-2'>
        {sprintsAvailable && (
          <Button
            variant={currentSprintOnly ? 'default' : 'outline'}
            size='sm'
            className='gap-1.5 h-7 text-xs'
            onClick={onToggleCurrentSprintOnly}
          >
            <CalendarClock className='h-3 w-3' />
            {intl.formatMessage({
              id: 'myTasks.currentSprintOnly',
              defaultMessage: 'Current sprint only',
            })}
          </Button>
        )}
        {currentSprintOnly && noActiveSprint && (
          <span className='text-xs text-muted-foreground'>
            {intl.formatMessage({
              id: 'myTasks.noActiveSprint',
              defaultMessage:
                'No active sprint — start one from the Sprints page.',
            })}
          </span>
        )}
      </div>
      <div className='flex items-center gap-2'>
        <DisplayOptionsMenu
          completedFilter={completedFilter}
          onCompletedFilterChange={onCompletedFilterChange}
          ordering={ordering}
          onOrderingChange={onOrderingChange}
          showSubtasks={showSubtasks}
          onShowSubtasksChange={onShowSubtasksChange}
        />
        <ViewToggle value={viewMode} onChange={onViewModeChange} />
      </div>
    </div>
  )
}
