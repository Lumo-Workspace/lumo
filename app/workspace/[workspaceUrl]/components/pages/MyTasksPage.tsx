'use client'

import { useState, useMemo } from 'react'
import { useIntl } from 'react-intl'
import { Plus, CheckSquare } from 'lucide-react'
import { MyTask, ApiStatus, ApiProject, WorkspaceMemberInfo } from '../../types'
import { BoardView } from '../board/BoardView'
import { MyTaskCard } from '../board/SortableTaskCard'
import { useBoardDrag } from '../../hooks/useBoardDrag'
import { AsyncContent } from '../AsyncContent'
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
import { TaskListTable } from '../task-list/TaskListTable'
import { MyTasksToolbar } from './my-tasks/MyTasksToolbar'
import { useTaskBulkMutations } from '../../hooks/useTaskBulkMutations'

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
  const {
    options,
    setCompletedFilter,
    setOrdering,
    setShowSubtasks,
    setCurrentSprintOnly,
  } = useDisplayOptions(CACHE_KEY.displayMyTasks(userId))
  const currentSprintOnly = options.currentSprintOnly
  const noActiveSprint = currentSprintOnly && activeSprintIds.length === 0

  const filteredTasks = useMemo(() => {
    let result = filterCompletedTasks(tasks, options.completedFilter)
    if (!options.showSubtasks) {
      result = result.filter(t => !t.parentTaskId)
    }
    if (currentSprintOnly) {
      // Filter against the task's own sprintId using the active sprint set.
      // An empty activeSprintIds collapses this to "show nothing" — the
      // banner above informs the user there's no active sprint.
      const active = new Set(activeSprintIds)
      result = result.filter(t => t.sprintId && active.has(t.sprintId))
    }
    return sortTasks(result, options.ordering)
  }, [
    tasks,
    options.completedFilter,
    options.ordering,
    options.showSubtasks,
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
      <div className='h-12 shrink-0 relative bg-white dark:bg-zinc-950'>
        <MyTasksToolbar
          sprintsAvailable={sprintsAvailable}
          currentSprintOnly={currentSprintOnly}
          onToggleCurrentSprintOnly={() =>
            setCurrentSprintOnly(!currentSprintOnly)
          }
          noActiveSprint={noActiveSprint}
          completedFilter={options.completedFilter}
          onCompletedFilterChange={setCompletedFilter}
          ordering={options.ordering}
          onOrderingChange={setOrdering}
          showSubtasks={options.showSubtasks}
          onShowSubtasksChange={setShowSubtasks}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
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

      {/* Content */}
      <div className='flex-1 flex flex-col overflow-hidden'>
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
            <div className='flex-1 overflow-auto'>
              <TaskListTable
                tasks={filteredTasks}
                setTasks={setTasks}
                members={members}
                projects={projects}
                onTaskClick={onTaskClick}
                onRetry={onRetry}
                selected={selected}
                setSelected={setSelected}
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
