'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { CheckSquare, Plus } from 'lucide-react'
import { MyTask, ApiStatus, ApiProject, WorkspaceMemberInfo } from '../../types'
import { BoardView } from '../../components/board/BoardView'
import { MyTaskCard } from '../../components/board/SortableTaskCard'
import { useBoardDrag } from '../../hooks/useBoardDrag'
import { AsyncContent } from '../../components/AsyncContent'
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
import { sortTasks } from '../../utils/sortTasks'
import { useTaskBulkMutations } from '../../hooks/useTaskBulkMutations'
import { BulkActionBar } from '../../components/task-list/BulkActionBar'
import { BulkDeleteConfirm } from '../../components/task-list/BulkDeleteConfirm'
import { TaskListTable } from '../../components/task-list/TaskListTable'
import { SprintTasksToolbar } from './SprintTasksToolbar'

interface SprintTasksViewProps {
  tasks: MyTask[]
  setTasks: React.Dispatch<React.SetStateAction<MyTask[]>>
  loading: boolean
  error: string | null
  onRetry: () => void
  onTaskClick: (task: MyTask) => void
  onNewTask: (status?: ApiStatus) => void
  members: WorkspaceMemberInfo[]
  projects: ApiProject[]
  /** Per-sprint localStorage key for display options. */
  displayOptionsKey: string
  /** Show the sidebar collapse toggle (next to view toggle). */
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}

export function SprintTasksView({
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
}: SprintTasksViewProps) {
  const intl = useIntl()
  // Sprints are traditionally viewed as a kanban — default to board.
  const [viewMode, setViewMode] = useState<'list' | 'board'>('board')
  const { options, setCompletedFilter, setOrdering, setShowSubtasks } =
    useDisplayOptions(displayOptionsKey)

  const filteredTasks = useMemo(() => {
    let result = filterCompletedTasks(tasks, options.completedFilter)
    if (!options.showSubtasks) {
      result = result.filter(t => !t.parentTaskId)
    }
    return sortTasks(result, options.ordering)
  }, [tasks, options.completedFilter, options.ordering, options.showSubtasks])

  const sensors = useBoardSensors()

  // viewId stays null — sprints don't own a kanban View, so same-column
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

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Toolbar — relative so the selection bar can absolute-overlay it */}
      <div className='h-12 shrink-0 relative bg-white dark:bg-zinc-950'>
        <SprintTasksToolbar
          completedFilter={options.completedFilter}
          onCompletedFilterChange={setCompletedFilter}
          ordering={options.ordering}
          onOrderingChange={setOrdering}
          showSubtasks={options.showSubtasks}
          onShowSubtasksChange={setShowSubtasks}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
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
                    id: 'sprints.tasks.empty.title',
                    defaultMessage: 'No tasks in this sprint yet',
                  })}
                </EmptyTitle>
                <EmptyDescription>
                  {intl.formatMessage({
                    id: 'sprints.tasks.empty.description',
                    defaultMessage:
                      'Click "Add task" or assign an existing task to this sprint from its detail page.',
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
