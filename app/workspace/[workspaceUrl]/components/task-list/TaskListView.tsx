'use client'

import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import type { RowSelectionState } from '@tanstack/react-table'
import { DataTable } from '../data-table/data-table'
import { createTaskColumns, type TaskPatch } from '../data-table/task-columns'
import {
  buildColumnTemplate,
  type ColumnId,
} from '../data-table/columnTemplate'
import type { ApiTask, ApiProject, WorkspaceMemberInfo } from '../../types'

interface Props {
  tasks: ApiTask[]
  members: WorkspaceMemberInfo[]
  /** Required when `visibleColumns` includes 'project' (feeds ProjectSelect). */
  projects?: ApiProject[]
  visibleColumns: ColumnId[]
  /** Must be a stable reference (useCallback) — it's a dependency of the columns memo. */
  updateTask: (id: string, patch: TaskPatch) => Promise<void> | void
  /** Must be a stable reference (useCallback). */
  onTaskClick: (task: ApiTask) => void
  /** Must be a stable reference (useCallback). */
  onDeleteTask: (taskId: string) => Promise<void>
  rowSelection: RowSelectionState
  onRowSelectionChange: (s: RowSelectionState) => void
  emptyLabel?: string
  /** Grow with the page's scroll flow instead of owning an internal scroll
   * region — see {@link DataTable}'s `flow`. */
  flow?: boolean
}

/**
 * Unified task-list table: builds the column set + grid template from
 * `visibleColumns` and renders the virtualized {@link DataTable}. Pages own
 * their own toolbar ({@link TaskListToolbar}) and bulk-action overlay, and
 * place this inside their async/content region.
 */
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
    <div
      className={props.flow ? 'flex flex-col' : 'flex flex-col flex-1 min-h-0'}
    >
      <DataTable
        columns={columns}
        data={props.tasks}
        columnTemplate={columnTemplate}
        {...(props.flow ? { flow: true } : {})}
        onRowClick={props.onTaskClick}
        enableSelection
        rowSelection={props.rowSelection}
        onRowSelectionChange={props.onRowSelectionChange}
        getRowId={(row: ApiTask) => row.id}
        {...(props.emptyLabel ? { emptyLabel: props.emptyLabel } : {})}
      />
    </div>
  )
}
