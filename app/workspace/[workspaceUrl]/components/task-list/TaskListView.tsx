'use client'

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import type { RowSelectionState } from '@tanstack/react-table'
import { DataTable } from '../data-table/data-table'
import { createTaskColumns, type TaskPatch } from '../data-table/task-columns'
import { buildColumnTemplate, type ColumnId } from '../data-table/columnTemplate'
import { TaskListToolbar } from './TaskListToolbar'
import type { ApiTask, ApiProject, WorkspaceMemberInfo } from '../../types'
import type { CompletedFilter } from '../../utils/filterCompletedTasks'
import type { TaskOrdering } from '../../utils/sortTasks'

interface TreeConfig {
  getParentId: (t: ApiTask) => string | null
  getChildCount: (t: ApiTask) => number
  getRowId: (t: ApiTask) => string
}

interface Props {
  tasks: ApiTask[]
  members: WorkspaceMemberInfo[]
  projects?: ApiProject[]
  visibleColumns: ColumnId[]
  updateTask: (id: string, patch: TaskPatch) => Promise<void> | void
  onTaskClick: (task: ApiTask) => void
  onDeleteTask: (taskId: string) => Promise<void>
  rowSelection: RowSelectionState
  onRowSelectionChange: (s: RowSelectionState) => void
  treeConfig?: TreeConfig
  completedFilter: CompletedFilter
  onCompletedFilterChange: (v: CompletedFilter) => void
  ordering: TaskOrdering
  onOrderingChange: (v: TaskOrdering) => void
  showSubtasks: boolean
  onShowSubtasksChange: (v: boolean) => void
  viewMode: 'list' | 'board'
  onViewModeChange: (m: 'list' | 'board') => void
  leftSlot?: ReactNode
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  /** Rendered between toolbar and table when selection is non-empty (BulkActionBar). */
  selectionBar?: ReactNode
}

export function TaskListView(props: Props) {
  const intl = useIntl()

  const columns = useMemo(
    () =>
      createTaskColumns({
        onTaskClick: props.onTaskClick,
        onDeleteTask: props.onDeleteTask,
        members: props.members,
        intl,
        updateTask: props.updateTask,
        visibleColumns: props.visibleColumns,
        projects: props.projects ?? [],
      }),
    [
      props.onTaskClick,
      props.onDeleteTask,
      props.members,
      intl,
      props.updateTask,
      props.visibleColumns,
      props.projects,
    ]
  )

  const columnTemplate = useMemo(
    () => buildColumnTemplate(props.visibleColumns),
    [props.visibleColumns]
  )

  return (
    <div className='flex flex-col flex-1 min-h-0'>
      <TaskListToolbar
        completedFilter={props.completedFilter}
        onCompletedFilterChange={props.onCompletedFilterChange}
        ordering={props.ordering}
        onOrderingChange={props.onOrderingChange}
        showSubtasks={props.showSubtasks}
        onShowSubtasksChange={props.onShowSubtasksChange}
        viewMode={props.viewMode}
        onViewModeChange={props.onViewModeChange}
        leftSlot={props.leftSlot}
        {...(props.onToggleSidebar
          ? { sidebarCollapsed: props.sidebarCollapsed, onToggleSidebar: props.onToggleSidebar }
          : {})}
      />
      {props.selectionBar}
      <DataTable
        columns={columns}
        data={props.tasks}
        columnTemplate={columnTemplate}
        onRowClick={props.onTaskClick}
        enableSelection
        rowSelection={props.rowSelection}
        onRowSelectionChange={props.onRowSelectionChange}
        getRowId={(row: ApiTask) => row.id}
        {...(props.treeConfig ? { treeConfig: props.treeConfig } : {})}
      />
    </div>
  )
}
