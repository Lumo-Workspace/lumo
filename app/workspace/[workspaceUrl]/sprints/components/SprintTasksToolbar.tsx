'use client'

import { useIntl } from 'react-intl'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { DisplayOptionsMenu } from '../../components/DisplayOptionsMenu'
import { ViewToggle } from '../../components/ViewToggle'
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
  /** Drives the icon + tooltip on the sprint-sidebar collapse button. */
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}

/**
 * Toolbar for the sprint tasks page: display options + view toggle + sprint
 * sidebar collapse toggle. The sidebar toggle is the only piece that's
 * sprint-specific; the rest mirrors the My Tasks toolbar.
 */
export function SprintTasksToolbar({
  completedFilter,
  onCompletedFilterChange,
  ordering,
  onOrderingChange,
  showSubtasks,
  onShowSubtasksChange,
  viewMode,
  onViewModeChange,
  sidebarCollapsed,
  onToggleSidebar,
}: Props) {
  const intl = useIntl()
  const sidebarLabel = intl.formatMessage({
    id: sidebarCollapsed
      ? 'sprints.detail.expandSidebar'
      : 'sprints.detail.collapseSidebar',
    defaultMessage: sidebarCollapsed
      ? 'Show sprint details'
      : 'Hide sprint details',
  })
  return (
    <div className='h-12 flex items-center justify-end gap-2 px-4 md:px-8'>
      <DisplayOptionsMenu
        completedFilter={completedFilter}
        onCompletedFilterChange={onCompletedFilterChange}
        ordering={ordering}
        onOrderingChange={onOrderingChange}
        showSubtasks={showSubtasks}
        onShowSubtasksChange={onShowSubtasksChange}
      />
      <ViewToggle value={viewMode} onChange={onViewModeChange} />
      <button
        type='button'
        onClick={onToggleSidebar}
        title={sidebarLabel}
        aria-label={sidebarLabel}
        className='flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
      >
        {sidebarCollapsed ? (
          <PanelRightOpen className='size-4' />
        ) : (
          <PanelRightClose className='size-4' />
        )}
      </button>
    </div>
  )
}
