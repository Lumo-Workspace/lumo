'use client'

import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import { Layers, Plus } from 'lucide-react'
import { ApiTask, ApiStatus, WorkspaceMemberInfo } from '../../../types'
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

  // Memoised columns — stable reference so TanStack Table doesn't re-create on every render
  const taskColumns = useMemo(
    () => createTaskColumns(onTaskClick, onDeleteTask),
    [onTaskClick, onDeleteTask]
  )

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Toolbar */}
      <div className='h-12 flex items-center justify-end gap-2 px-4 md:px-8 shrink-0'>
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
