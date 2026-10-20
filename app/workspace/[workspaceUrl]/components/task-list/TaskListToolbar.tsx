'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { DisplayOptionsMenu } from '../DisplayOptionsMenu'
import { ViewToggle } from '../ViewToggle'
import type { CompletedFilter } from '../../utils/filterCompletedTasks'
import type { TaskOrdering } from '../../utils/sortTasks'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface Props {
  completedFilter: CompletedFilter
  onCompletedFilterChange: (value: CompletedFilter) => void
  ordering: TaskOrdering
  onOrderingChange: (value: TaskOrdering) => void
  viewMode: 'list' | 'board'
  onViewModeChange: (mode: 'list' | 'board') => void
  /**
   * The scope's filter entry point — rendered immediately before the Display
   * menu. Required (rather than optional) so a new board can't silently ship
   * without one; pass `null` only for a scope that genuinely cannot filter.
   */
  filterMenu: ReactNode
  leftSlot?: ReactNode
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  /**
   * Scope-specific tooltip/aria copy for the collapse toggle. Defaults to the
   * sprint wording so existing sprint callers keep their copy untouched.
   */
  sidebarExpandLabel?: string
  sidebarCollapseLabel?: string
}

export function TaskListToolbar({
  completedFilter,
  onCompletedFilterChange,
  ordering,
  onOrderingChange,
  viewMode,
  onViewModeChange,
  filterMenu,
  leftSlot,
  sidebarCollapsed,
  onToggleSidebar,
  sidebarExpandLabel,
  sidebarCollapseLabel,
}: Props) {
  const intl = useIntl()
  const defaultSidebarLabel = intl.formatMessage(
    sidebarCollapsed
      ? {
          id: 'sprints.detail.expandSidebar',
          defaultMessage: 'Show sprint details',
        }
      : {
          id: 'sprints.detail.collapseSidebar',
          defaultMessage: 'Hide sprint details',
        }
  )
  const sidebarLabel =
    (sidebarCollapsed ? sidebarExpandLabel : sidebarCollapseLabel) ??
    defaultSidebarLabel

  return (
    <div className='h-12 flex items-center justify-between gap-2 px-4 md:px-8'>
      <div className='flex items-center gap-2'>{leftSlot}</div>
      <div className='flex items-center gap-2'>
        {filterMenu}
        <DisplayOptionsMenu
          completedFilter={completedFilter}
          onCompletedFilterChange={onCompletedFilterChange}
          ordering={ordering}
          onOrderingChange={onOrderingChange}
        />
        <ViewToggle value={viewMode} onChange={onViewModeChange} />
        {onToggleSidebar && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type='button'
                onClick={onToggleSidebar}
                aria-label={sidebarLabel}
                className='flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
              >
                {sidebarCollapsed ? (
                  <PanelRightOpen className='size-4' />
                ) : (
                  <PanelRightClose className='size-4' />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>{sidebarLabel}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
