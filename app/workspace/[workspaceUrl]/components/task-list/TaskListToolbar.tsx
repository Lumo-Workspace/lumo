'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { DisplayOptionsMenu } from '../DisplayOptionsMenu'
import { ViewToggle } from '../ViewToggle'
import type { CompletedFilter } from '../../utils/filterCompletedTasks'
import type { TaskOrdering } from '../../utils/sortTasks'

interface Props {
  completedFilter: CompletedFilter
  onCompletedFilterChange: (value: CompletedFilter) => void
  ordering: TaskOrdering
  onOrderingChange: (value: TaskOrdering) => void
  showSubtasks: boolean
  onShowSubtasksChange: (value: boolean) => void
  viewMode: 'list' | 'board'
  onViewModeChange: (mode: 'list' | 'board') => void
  leftSlot?: ReactNode
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
}

export function TaskListToolbar({
  completedFilter,
  onCompletedFilterChange,
  ordering,
  onOrderingChange,
  showSubtasks,
  onShowSubtasksChange,
  viewMode,
  onViewModeChange,
  leftSlot,
  sidebarCollapsed,
  onToggleSidebar,
}: Props) {
  const intl = useIntl()

  return (
    <div className='h-12 flex items-center justify-between gap-2 px-4 md:px-8'>
      <div className='flex items-center gap-2'>{leftSlot}</div>
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
        {onToggleSidebar && (
          <button
            type='button'
            onClick={onToggleSidebar}
            aria-label={intl.formatMessage(
              sidebarCollapsed
                ? {
                    id: 'sprints.detail.expandSidebar',
                    defaultMessage: 'Show sprint details',
                  }
                : {
                    id: 'sprints.detail.collapseSidebar',
                    defaultMessage: 'Hide sprint details',
                  }
            )}
            className='flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
          >
            {sidebarCollapsed ? (
              <PanelRightOpen className='size-4' />
            ) : (
              <PanelRightClose className='size-4' />
            )}
          </button>
        )}
      </div>
    </div>
  )
}
