'use client'

import { useState, useMemo, useCallback } from 'react'
import { useIntl } from 'react-intl'
import { Plus, CheckSquare, CalendarClock } from 'lucide-react'
import { toast } from 'sonner'
import type { RowSelectionState } from '@tanstack/react-table'
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
import {
  TaskBoardSkeleton,
  TaskTableSkeleton,
} from '../skeletons/TaskSkeletons'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { useBoardSensors } from '../../hooks/useBoardSensors'
import { useDisplayOptions } from '../../hooks/useDisplayOptions'
import { filterCompletedTasks } from '../../utils/filterCompletedTasks'
import { sortTasks, ORDERING_LABELS } from '../../utils/sortTasks'
import { CACHE_KEY } from '../../constants'
import { PageBreadcrumb } from '../PageBreadcrumb'
import { BulkActionBar } from '../task-list/BulkActionBar'
import { BulkDeleteConfirm } from '../task-list/BulkDeleteConfirm'
import { TaskListView } from '../task-list/TaskListView'
import { TaskListToolbar } from '../task-list/TaskListToolbar'
import { TaskFilterChips } from '../task-list/TaskFilterChips'
import { TaskFilterMenu } from '../task-list/TaskFilterMenu'
import { useTaskFiltering } from '../../hooks/useTaskFiltering'
import { useTaskBulkMutations } from '../../hooks/useTaskBulkMutations'

// Stable reference so TaskListView's columns memo doesn't recompute each render.
const MY_TASKS_COLUMNS: ColumnId[] = [
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

interface MyTasksPageProps {
  tasks: MyTask[]
  setTasks: React.Dispatch<React.SetStateAction<MyTask[]>>
  viewId: string | null
  userId: string
  loading: boolean
  error: string | null
  onRetry: () => void
  onTaskClick: (task: MyTask) => void
  onNewTask: (status?: ApiStatus) => void
  members: WorkspaceMemberInfo[]
  projects: ApiProject[]
  // Workspace has at least one team with sprints enabled — gates visibility
  // of the "current sprint only" toggle.
  sprintsAvailable?: boolean
  // Sprint IDs the user currently has active (i.e. CURRENT time window,
  // across all teams). Used for client-side filtering only.
  activeSprintIds?: string[]
}

export function MyTasksPage({
  tasks,
  setTasks,
  viewId,
  userId,
  loading,
  error,
  onRetry,
  onTaskClick,
  onNewTask,
  members,
  projects,
  sprintsAvailable = false,
  activeSprintIds = [],
}: MyTasksPageProps) {
  const intl = useIntl()
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list')
  const { options, setCompletedFilter, setOrdering, setCurrentSprintOnly } =
    useDisplayOptions(CACHE_KEY.displayMyTasks(userId))
  const currentSprintOnly = options.currentSprintOnly
  const noActiveSprint = currentSprintOnly && activeSprintIds.length === 0

  const {
    now,
    filters,
    toggleValue,
    clearDimension,
    clearAll,
    filteredTasks: narrowedTasks,
  } = useTaskFiltering({
    tasks,
    scopeKey: CACHE_KEY.displayMyTasks(userId),
  })

  const filteredTasks = useMemo(() => {
    let result = filterCompletedTasks(narrowedTasks, options.completedFilter)
    if (currentSprintOnly) {
      // Filter against the task's own sprintId using the active sprint set.
      // An empty activeSprintIds collapses this to "show nothing" — the
      // banner above informs the user there's no active sprint.
      const active = new Set(activeSprintIds)
      result = result.filter(t => t.sprintId && active.has(t.sprintId))
    }
    return sortTasks(result, options.ordering)
  }, [
    narrowedTasks,
    options.completedFilter,
    options.ordering,
    currentSprintOnly,
    activeSprintIds,
  ])

  const sensors = useBoardSensors()

  const { activeId, onDragStart, onDragOver, onDragEnd } = useBoardDrag({
    tasks,
    setTasks,
    viewId,
  })

  // ─── Selection state (lifted up so bar can render in toolbar slot) ──────────
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

  // ─── Single-row inline update (moved from TaskListTable) ─────────────────────
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
      {/* Breadcrumb */}
      <PageBreadcrumb title={intl.formatMessage({ id: 'sidebar.myTasks' })} />

      {/* Page header — Create Task button right-aligned */}
      <header className='pt-4 pb-4 px-4 md:px-8 flex items-center justify-end shrink-0'>
        <Button onClick={() => onNewTask()} size='sm' className='gap-1.5'>
          <Plus size={18} />
          {intl.formatMessage({
            id: 'task.create',
            defaultMessage: 'Create Task',
          })}
        </Button>
      </header>

      {/* Toolbar — relative so the selection bar can absolute-overlay it */}
      <div className='h-12 shrink-0 relative bg-card'>
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
          leftSlot={
            sprintsAvailable ? (
              <>
                <Button
                  variant={currentSprintOnly ? 'default' : 'outline'}
                  size='sm'
                  className='gap-1.5 h-7 text-caption'
                  onClick={() => setCurrentSprintOnly(!currentSprintOnly)}
                >
                  <CalendarClock className='h-3 w-3' />
                  {intl.formatMessage({
                    id: 'myTasks.currentSprintOnly',
                    defaultMessage: 'Current sprint only',
                  })}
                </Button>
                {currentSprintOnly && noActiveSprint && (
                  <span className='text-caption text-muted-foreground'>
                    {intl.formatMessage({
                      id: 'myTasks.noActiveSprint',
                      defaultMessage:
                        'No active sprint — start one from the Sprints page.',
                    })}
                  </span>
                )}
              </>
            ) : null
          }
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
          loadingState={
            viewMode === 'board' ? <TaskBoardSkeleton /> : <TaskTableSkeleton />
          }
          className='flex-1 flex flex-col overflow-hidden'
          emptyState={
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <CheckSquare />
                </EmptyMedia>
                <EmptyTitle>
                  {intl.formatMessage({
                    id: 'task.empty.title',
                    defaultMessage: 'No tasks yet',
                  })}
                </EmptyTitle>
                <EmptyDescription>
                  {intl.formatMessage({
                    id: 'task.empty.description',
                    defaultMessage: 'Tasks assigned to you will appear here.',
                  })}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => onNewTask()}>
                  <Plus size={16} />
                  {intl.formatMessage({
                    id: 'task.create',
                    defaultMessage: 'Create Task',
                  })}
                </Button>
              </EmptyContent>
            </Empty>
          }
        >
          {viewMode === 'list' ? (
            <div className='flex-1 min-h-0 flex flex-col'>
              <TaskListView
                tasks={filteredTasks}
                members={members}
                projects={projects}
                visibleColumns={MY_TASKS_COLUMNS}
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
              orderingLabel={
                options.ordering !== 'manual'
                  ? ORDERING_LABELS[options.ordering]
                  : undefined
              }
              renderCard={(task, isOverlay) => (
                <MyTaskCard
                  key={task.id}
                  task={task}
                  isOverlay={isOverlay}
                  onClick={() => onTaskClick(task)}
                />
              )}
              onAddTask={columnId => onNewTask(columnId as ApiStatus)}
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
