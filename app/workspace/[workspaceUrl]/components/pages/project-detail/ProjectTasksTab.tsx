'use client'

import { useState, useMemo, useCallback } from 'react'
import { useIntl } from 'react-intl'
import { Layers, Plus } from 'lucide-react'
import {
  ApiTask,
  ApiStatus,
  ApiPriority,
  WorkspaceMemberInfo,
} from '../../../types'
import { BoardView } from '../../board/BoardView'
import { ProjectTaskCard } from '../../board/SortableTaskCard'
import { ORDERING_LABELS, TaskOrdering } from '../../../utils/sortTasks'
import { CompletedFilter } from '../../../utils/filterCompletedTasks'
import { AsyncContent } from '../../AsyncContent'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { TaskPatch } from '../../data-table/task-columns'
import { tasksClient } from '@/lib/api-client'
import { toast } from 'sonner'
import { TaskListToolbar } from '../../task-list/TaskListToolbar'
import { TaskFilterChips } from '../../task-list/TaskFilterChips'
import { TaskFilterMenu } from '../../task-list/TaskFilterMenu'
import { useTaskFiltering } from '../../../hooks/useTaskFiltering'
import { CACHE_KEY } from '../../../constants'
import { TaskListView } from '../../task-list/TaskListView'
import { BulkActionBar } from '../../task-list/BulkActionBar'
import { BulkDeleteConfirm } from '../../task-list/BulkDeleteConfirm'
import type {
  SensorDescriptor,
  SensorOptions,
  DragOverEvent,
  DragEndEvent,
} from '@dnd-kit/core'

interface DisplayOptions {
  completedFilter: CompletedFilter
  ordering: TaskOrdering
  showSubtasks: boolean
}

interface ProjectTasksTabProps {
  projectId: string
  tasks: ApiTask[]
  setTasks: React.Dispatch<React.SetStateAction<ApiTask[]>>
  filteredTasks: ApiTask[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onNewTask: (status?: ApiStatus) => void
  onTaskClick: (task: ApiTask) => void
  onDeleteTask: (taskId: string) => Promise<void>
  members: WorkspaceMemberInfo[]
  currentActorId?: string | null | undefined
  isOwner?: boolean | undefined
  viewMode: 'list' | 'board'
  setViewMode: (mode: 'list' | 'board') => void
  displayOptions: DisplayOptions
  setCompletedFilter: (v: CompletedFilter) => void
  setOrdering: (v: TaskOrdering) => void
  setShowSubtasks: (v: boolean) => void
  sensors: SensorDescriptor<SensorOptions>[]
  activeId: string | null
  onDragStart: (event: { active: { id: string | number } }) => void
  onDragOver: (event: DragOverEvent) => void
  onDragEnd: (event: DragEndEvent) => void
}

export function ProjectTasksTab({
  projectId,
  tasks,
  setTasks,
  filteredTasks,
  loading,
  error,
  onRetry,
  onNewTask,
  onTaskClick,
  onDeleteTask,
  members,
  currentActorId,
  isOwner,
  viewMode,
  setViewMode,
  displayOptions,
  setCompletedFilter,
  setOrdering,
  setShowSubtasks,
  sensors,
  activeId,
  onDragStart,
  onDragOver,
  onDragEnd,
}: ProjectTasksTabProps) {
  const intl = useIntl()

  const {
    now,
    filters,
    toggleValue,
    clearDimension,
    clearAll,
    filteredTasks: narrowedTasks,
  } = useTaskFiltering({
    tasks: filteredTasks,
    scopeKey: CACHE_KEY.displayProject(projectId),
  })

  // ─── Row selection ──────────────────────────────────────────────────────────
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter(id => rowSelection[id]),
    [rowSelection]
  )
  const selectedCount = selectedIds.length

  // ─── Bulk delete confirmation state ────────────────────────────────────────
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // ─── Single-row inline update ───────────────────────────────────────────────
  const updateTask = useCallback(
    async (id: string, patch: TaskPatch) => {
      setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
      try {
        await tasksClient.update(id, patch)
      } catch {
        toast.error('Failed to update task')
        onRetry()
      }
    },
    [setTasks, onRetry]
  )

  // ─── Memoised column list ───────────────────────────────────────────────────
  const visibleColumns = useMemo(
    () =>
      [
        'select',
        'identifier',
        'title',
        'status',
        'priority',
        'dueDate',
        'assignee',
        'updatedAt',
        'actions',
      ] as const,
    []
  )

  // ─── Bulk actions ───────────────────────────────────────────────────────────
  const runBulkUpdate = async (
    patch: Partial<{
      status: ApiStatus
      priority: ApiPriority
      assigneeActorId: string | null
    }>
  ) => {
    const ids = selectedIds
    const results = await Promise.allSettled(
      ids.map(id => tasksClient.update(id, patch))
    )
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) {
      toast.error(
        `Failed to update ${failed} of ${ids.length} task${ids.length === 1 ? '' : 's'}`
      )
      onRetry()
    } else {
      const idSet = new Set(ids)
      setTasks(prev =>
        prev.map(t =>
          idSet.has(t.id)
            ? {
                ...t,
                ...(patch.status !== undefined ? { status: patch.status } : {}),
                ...(patch.priority !== undefined
                  ? { priority: patch.priority }
                  : {}),
                ...(patch.assigneeActorId !== undefined
                  ? { assigneeActorId: patch.assigneeActorId }
                  : {}),
              }
            : t
        )
      )
      toast.success(`Updated ${ids.length} task${ids.length === 1 ? '' : 's'}`)
    }
    setRowSelection({})
  }

  const runBulkDelete = async () => {
    setDeleting(true)
    try {
      const ids = selectedIds
      const results = await Promise.allSettled(
        ids.map(id => tasksClient.delete(id))
      )
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) {
        toast.error(
          `Failed to delete ${failed} of ${ids.length} task${ids.length === 1 ? '' : 's'}`
        )
        onRetry()
      } else {
        const idSet = new Set(ids)
        setTasks(prev => prev.filter(t => !idSet.has(t.id)))
        toast.success(
          `Deleted ${ids.length} task${ids.length === 1 ? '' : 's'}`
        )
      }
    } finally {
      setDeleting(false)
      setConfirmDeleteOpen(false)
      setRowSelection({})
    }
  }

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Toolbar */}
      <div className='h-12 shrink-0 relative'>
        <TaskListToolbar
          completedFilter={displayOptions.completedFilter}
          onCompletedFilterChange={setCompletedFilter}
          ordering={displayOptions.ordering}
          onOrderingChange={setOrdering}
          showSubtasks={displayOptions.showSubtasks}
          onShowSubtasksChange={setShowSubtasks}
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
        />
        {selectedCount > 0 && (
          <BulkActionBar
            count={selectedCount}
            members={members}
            onBulkUpdate={runBulkUpdate}
            onRequestDelete={() => setConfirmDeleteOpen(true)}
            onClearSelection={() => setRowSelection({})}
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
      <AsyncContent
        loading={loading}
        error={error}
        empty={narrowedTasks.length === 0 && viewMode !== 'board'}
        onRetry={onRetry}
        className='flex-1 flex flex-col overflow-hidden'
        emptyState={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <Layers />
              </EmptyMedia>
              <EmptyTitle>
                {intl.formatMessage({
                  id: 'project.noTasksYet',
                  defaultMessage: 'No tasks yet',
                })}
              </EmptyTitle>
              <EmptyDescription>
                {intl.formatMessage({
                  id: 'project.noTasksDesc',
                  defaultMessage:
                    'This project has no tasks. Add the first one to get started.',
                })}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => onNewTask()}>
                <Plus size={16} />
                {intl.formatMessage({
                  id: 'project.createTask',
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
              tasks={narrowedTasks}
              members={members}
              visibleColumns={[...visibleColumns]}
              updateTask={updateTask}
              onTaskClick={onTaskClick}
              onDeleteTask={onDeleteTask}
              rowSelection={rowSelection}
              onRowSelectionChange={setRowSelection}
              {...(displayOptions.showSubtasks
                ? {
                    treeConfig: {
                      getParentId: (task: ApiTask) => task.parentTaskId,
                      getChildCount: (task: ApiTask) =>
                        task._count?.children ?? 0,
                      getRowId: (task: ApiTask) => task.id,
                    },
                  }
                : {})}
            />
          </div>
        ) : (
          <BoardView
            tasks={narrowedTasks}
            sensors={sensors}
            activeId={activeId}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            orderingLabel={
              displayOptions.ordering !== 'manual'
                ? ORDERING_LABELS[displayOptions.ordering]
                : undefined
            }
            renderCard={(task, isOverlay) => (
              <ProjectTaskCard
                key={task.id}
                task={task}
                isOverlay={isOverlay}
                members={members}
                currentActorId={currentActorId}
                isOwner={isOwner}
                onClick={() => onTaskClick(task)}
                onParentClick={parentId => {
                  const parentTask = tasks.find(t => t.id === parentId)
                  if (parentTask) onTaskClick(parentTask)
                }}
              />
            )}
            onAddTask={columnId => onNewTask(columnId as ApiStatus)}
          />
        )}
      </AsyncContent>

      <BulkDeleteConfirm
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        count={selectedCount}
        deleting={deleting}
        onConfirm={runBulkDelete}
      />
    </div>
  )
}
