'use client'

import { useState, useMemo } from 'react'
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
import { ViewToggle } from '../../ViewToggle'
import { DisplayOptionsMenu } from '../../DisplayOptionsMenu'
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
import { DataTable } from '../../data-table/data-table'
import { createTaskColumns } from '../../data-table/task-columns'
import { TaskSelectionBar } from '../../data-table/TaskSelectionBar'
import { tasksClient } from '@/lib/api-client'
import { toast } from 'sonner'
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

  // ─── Row selection ──────────────────────────────────────────────────────────
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter(id => rowSelection[id]),
    [rowSelection]
  )
  const selectedCount = selectedIds.length

  // ─── Memoised columns ───────────────────────────────────────────────────────
  const taskColumns = useMemo(
    () => createTaskColumns(onTaskClick, onDeleteTask, members, intl),
    [onTaskClick, onDeleteTask, members, intl]
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
      toast.success(`Deleted ${ids.length} task${ids.length === 1 ? '' : 's'}`)
    }
    setRowSelection({})
  }

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Toolbar */}
      <div className='h-12 shrink-0 relative'>
        <div className='h-12 flex items-center justify-end gap-2 px-4 md:px-8'>
          <DisplayOptionsMenu
            completedFilter={displayOptions.completedFilter}
            onCompletedFilterChange={setCompletedFilter}
            ordering={displayOptions.ordering}
            onOrderingChange={setOrdering}
            showSubtasks={displayOptions.showSubtasks}
            onShowSubtasksChange={setShowSubtasks}
          />
          <ViewToggle value={viewMode} onChange={setViewMode} />
        </div>
        <TaskSelectionBar
          selectedCount={selectedCount}
          members={members}
          onStatusPick={status => runBulkUpdate({ status })}
          onPriorityPick={priority => runBulkUpdate({ priority })}
          onAssigneePick={assigneeActorId => runBulkUpdate({ assigneeActorId })}
          onDelete={runBulkDelete}
          onCancel={() => setRowSelection({})}
        />
      </div>

      {/* Content */}
      <AsyncContent
        loading={loading}
        error={error}
        empty={filteredTasks.length === 0 && viewMode !== 'board'}
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
          <div className='flex-1 overflow-auto'>
            <DataTable
              columns={taskColumns}
              data={filteredTasks}
              onRowClick={onTaskClick}
              enableSelection
              rowSelection={rowSelection}
              onRowSelectionChange={setRowSelection}
              getRowId={(row: ApiTask) => row.id}
              {...(displayOptions.showSubtasks && {
                treeConfig: {
                  getParentId: (task: ApiTask) => task.parentTaskId,
                  getChildCount: (task: ApiTask) => task._count?.children ?? 0,
                  getRowId: (task: ApiTask) => task.id,
                },
              })}
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
            onAddTask={onNewTask}
          />
        )}
      </AsyncContent>
    </div>
  )
}
