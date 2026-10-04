'use client'

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import { toast } from 'sonner'
import {
  MyTask,
  ApiTask,
  ApiStatus,
  ApiProject,
  WorkspaceMemberInfo,
} from '../../types'
import { tasksClient } from '@/lib/api-client'
import type { TaskPatch } from '../data-table/task-columns'
import type { ColumnId } from '../data-table/columnTemplate'
import { BoardView } from '../board/BoardView'
import { MyTaskCard } from '../board/SortableTaskCard'
import { useBoardDrag } from '../../hooks/useBoardDrag'
import { AsyncContent } from '../AsyncContent'
import { useBoardSensors } from '../../hooks/useBoardSensors'
import { useDisplayOptions } from '../../hooks/useDisplayOptions'
import { useTaskFiltering } from '../../hooks/useTaskFiltering'
import { filterCompletedTasks } from '../../utils/filterCompletedTasks'
import { sortTasks } from '../../utils/sortTasks'
import { useTaskBulkMutations } from '../../hooks/useTaskBulkMutations'
import { BulkActionBar } from './BulkActionBar'
import { BulkDeleteConfirm } from './BulkDeleteConfirm'
import { TaskFilterChips } from './TaskFilterChips'
import { TaskFilterMenu } from './TaskFilterMenu'
import { TaskListView } from './TaskListView'
import { TaskListToolbar } from './TaskListToolbar'

// Default column set for a detail-page task workspace. A stable module-level
// reference keeps TaskListView's columns memo from recomputing each render.
const DEFAULT_COLUMNS: ColumnId[] = [
  'select',
  'identifier',
  'title',
  'project',
  'status',
  'priority',
  'dueDate',
  'assignee',
  'updatedAt',
  'actions',
]

interface TaskWorkspaceViewProps {
  tasks: MyTask[]
  setTasks: React.Dispatch<React.SetStateAction<MyTask[]>>
  loading: boolean
  error: string | null
  onRetry: () => void
  onTaskClick: (task: MyTask) => void
  /**
   * Open the new-task flow for a column. When omitted, no "Add task"
   * affordances are shown — used by the milestone board, where NewTaskModal
   * can't pre-bind a milestone, so creating from here would land tasks outside
   * the milestone.
   */
  onNewTask?: (status?: ApiStatus) => void
  members: WorkspaceMemberInfo[]
  projects: ApiProject[]
  /** Per-scope localStorage key for display options. */
  displayOptionsKey: string
  /** Show + drive the properties-rail collapse toggle in the toolbar. Omit
   * both when the scope has no properties rail — the toolbar then hides the
   * toggle. */
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  /** Scope-specific tooltip/aria copy for the collapse toggle. */
  sidebarExpandLabel?: string
  sidebarCollapseLabel?: string
  /** Empty state for the list view when the scope has no tasks. */
  emptyState: ReactNode
  /** Columns for the list view. Defaults to the standard detail-page set. */
  visibleColumns?: ColumnId[]
  /** View mode on first mount. Defaults to 'board'. */
  defaultViewMode?: 'list' | 'board'
}

/**
 * Shared task workspace for detail pages (sprint / milestone): a toolbar with
 * display options + board/list toggle + properties-rail collapse, over a kanban
 * board or the unified list view. Cross-column drag changes a task's status;
 * bulk actions and inline edits operate on the same local task set. The page
 * owns the task data (so it can refetch) and the collapse state.
 */
export function TaskWorkspaceView({
  tasks,
  setTasks,
  loading,
  error,
  onRetry,
  onTaskClick,
  onNewTask,
  members,
  projects,
  displayOptionsKey,
  sidebarCollapsed,
  onToggleSidebar,
  sidebarExpandLabel,
  sidebarCollapseLabel,
  emptyState,
  visibleColumns = DEFAULT_COLUMNS,
  defaultViewMode = 'board',
}: TaskWorkspaceViewProps) {
  const [viewMode, setViewMode] = useState<'list' | 'board'>(defaultViewMode)
  const { options, setCompletedFilter, setOrdering } =
    useDisplayOptions(displayOptionsKey)

  const {
    now,
    filters,
    toggleValue,
    clearDimension,
    clearAll,
    filteredTasks: narrowedTasks,
  } = useTaskFiltering({ tasks, scopeKey: displayOptionsKey })

  const filteredTasks = useMemo(() => {
    const result = filterCompletedTasks(narrowedTasks, options.completedFilter)
    return sortTasks(result, options.ordering)
  }, [narrowedTasks, options.completedFilter, options.ordering])

  const sensors = useBoardSensors()

  // viewId stays null — these scopes don't own a kanban View, so same-column
  // reorder persistence is skipped inside useBoardDrag. Cross-column
  // status-change drag still works.
  const { activeId, onDragStart, onDragOver, onDragEnd } = useBoardDrag({
    tasks,
    setTasks,
    viewId: null,
  })

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const {
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    deleting,
    runBulkUpdate,
    runBulkDelete,
  } = useTaskBulkMutations({ tasks, selected, setSelected, setTasks, onRetry })

  // ─── Selection bridge: Set (source of truth) ↔ table RowSelectionState ───────
  const rowSelection = useMemo<RowSelectionState>(
    () => Object.fromEntries([...selected].map(id => [id, true])),
    [selected]
  )
  const handleRowSelectionChange = useCallback(
    (next: RowSelectionState) =>
      setSelected(new Set(Object.keys(next).filter(id => next[id]))),
    [setSelected]
  )

  // ─── Single-row inline update (unified table's editable cells) ───────────────
  const updateTask = useCallback(
    async (id: string, patch: TaskPatch) => {
      setTasks(prev =>
        prev.map(t => {
          if (t.id !== id) return t
          // When project changes, also refresh the embedded { id, name, ownerActorId }
          // so the row updates without waiting for a refetch.
          if (patch.projectId && patch.projectId !== t.projectId) {
            const np = projects.find(p => p.id === patch.projectId)
            return {
              ...t,
              ...patch,
              project: np
                ? {
                    id: np.id,
                    name: np.name,
                    ownerActorId:
                      (np as { ownerActorId?: string | null }).ownerActorId ??
                      null,
                  }
                : t.project,
            }
          }
          return { ...t, ...patch }
        })
      )
      try {
        await tasksClient.update(id, patch)
      } catch {
        toast.error('Failed to update task')
        onRetry()
      }
    },
    [setTasks, projects, onRetry]
  )

  // ─── Single-row delete (unified table's actions column) ──────────────────────
  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      setTasks(prev => prev.filter(t => t.id !== taskId))
      try {
        await tasksClient.delete(taskId)
      } catch {
        toast.error('Failed to delete task')
        onRetry()
      }
    },
    [setTasks, onRetry]
  )

  // ─── onTaskClick adapter (rows are MyTask, table types as ApiTask) ───────────
  const handleTaskClick = useCallback(
    (task: ApiTask) => onTaskClick(task as MyTask),
    [onTaskClick]
  )

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Toolbar — relative so the selection bar can absolute-overlay it */}
      <div className='h-12 shrink-0 relative bg-background'>
        <TaskListToolbar
          completedFilter={options.completedFilter}
          onCompletedFilterChange={setCompletedFilter}
          ordering={options.ordering}
          onOrderingChange={setOrdering}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          filterMenu={
            <TaskFilterMenu
              tasks={tasks}
              filters={filters}
              members={members}
              now={now}
              onToggleValue={toggleValue}
            />
          }
          {...(sidebarCollapsed !== undefined && { sidebarCollapsed })}
          {...(onToggleSidebar !== undefined && { onToggleSidebar })}
          {...(sidebarExpandLabel !== undefined && { sidebarExpandLabel })}
          {...(sidebarCollapseLabel !== undefined && { sidebarCollapseLabel })}
        />
        {selected.size > 0 && (
          <BulkActionBar
            count={selected.size}
            members={members}
            onBulkUpdate={runBulkUpdate}
            onRequestDelete={() => setConfirmDeleteOpen(true)}
            onClearSelection={() => setSelected(new Set())}
          />
        )}
      </div>

      <TaskFilterChips
        tasks={tasks}
        filters={filters}
        members={members}
        onClearDimension={clearDimension}
        onClearAll={clearAll}
      />

      {/* Content */}
      <div className='flex-1 flex flex-col overflow-hidden'>
        <AsyncContent
          loading={loading}
          error={error}
          empty={filteredTasks.length === 0 && viewMode !== 'board'}
          onRetry={onRetry}
          className='flex-1 flex flex-col overflow-hidden'
          emptyState={emptyState}
        >
          {viewMode === 'list' ? (
            <div className='flex-1 min-h-0 flex flex-col'>
              <TaskListView
                tasks={filteredTasks}
                members={members}
                projects={projects}
                visibleColumns={visibleColumns}
                updateTask={updateTask}
                onTaskClick={handleTaskClick}
                onDeleteTask={handleDeleteTask}
                rowSelection={rowSelection}
                onRowSelectionChange={handleRowSelectionChange}
              />
            </div>
          ) : (
            <BoardView
              tasks={filteredTasks}
              sensors={sensors}
              activeId={activeId}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              renderCard={(task, isOverlay) => (
                <MyTaskCard
                  key={task.id}
                  task={task}
                  isOverlay={isOverlay}
                  onClick={() => onTaskClick(task)}
                />
              )}
              {...(onNewTask && {
                onAddTask: (columnId: string) =>
                  onNewTask(columnId as ApiStatus),
              })}
            />
          )}
        </AsyncContent>
      </div>

      <BulkDeleteConfirm
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        count={selected.size}
        deleting={deleting}
        onConfirm={runBulkDelete}
      />
    </div>
  )
}
