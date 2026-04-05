'use client'

import { useState, useMemo } from 'react'
import { Plus, CheckSquare } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'
import { MyTask, ApiStatus } from '../../types'
import { API_STATUS_LABEL } from '../../utils'
import { StatusIcon } from '../StatusIcon'
import { PriorityBadge } from '../PriorityBadge'
import { BoardView } from '../board/BoardView'
import { MyTaskCard } from '../board/SortableTaskCard'
import { useBoardDrag } from '../../hooks/useBoardDrag'
import { SortableHeader } from '../SortableHeader'
import { ViewToggle } from '../ViewToggle'
import { DisplayOptionsMenu } from '../DisplayOptionsMenu'
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
import {
  useTableSort,
  applyDir,
  cmpString,
  cmpStatus,
  cmpPriority,
  cmpDate,
} from '../../hooks/useTableSort'
import { useBoardSensors } from '../../hooks/useBoardSensors'
import { useDisplayOptions } from '../../hooks/useDisplayOptions'
import { filterCompletedTasks } from '../../utils/filterCompletedTasks'
import { sortTasks, ORDERING_LABELS } from '../../utils/sortTasks'
import { CACHE_KEY } from '../../constants'
import { PageBreadcrumb } from '../PageBreadcrumb'

type MyTaskSortKey = 'title' | 'project' | 'status' | 'priority' | 'updatedAt'

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
}: MyTasksPageProps) {
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list')
  const { options, setCompletedFilter, setOrdering, setShowSubtasks } =
    useDisplayOptions(CACHE_KEY.displayMyTasks(userId))
  const filteredTasks = useMemo(() => {
    let result = filterCompletedTasks(tasks, options.completedFilter)
    if (!options.showSubtasks) {
      result = result.filter(t => !t.parentTaskId)
    }
    return sortTasks(result, options.ordering)
  }, [tasks, options.completedFilter, options.ordering, options.showSubtasks])

  const sensors = useBoardSensors()

  const { activeId, onDragStart, onDragOver, onDragEnd } = useBoardDrag({
    tasks,
    setTasks,
    viewId,
  })

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Breadcrumb */}
      <PageBreadcrumb>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>My Tasks</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </PageBreadcrumb>
      <header className='pt-4 pb-4 px-4 md:px-8 flex items-center justify-end shrink-0'>
        <Button onClick={() => onNewTask()} size='sm' className='gap-1.5'>
          <Plus size={18} />
          Create Task
        </Button>
      </header>

      {/* Toolbar */}
      <div className='h-12 flex items-center justify-end gap-2 px-4 md:px-8 shrink-0 bg-white dark:bg-zinc-950'>
        <DisplayOptionsMenu
          completedFilter={options.completedFilter}
          onCompletedFilterChange={setCompletedFilter}
          ordering={options.ordering}
          onOrderingChange={setOrdering}
          showSubtasks={options.showSubtasks}
          onShowSubtasksChange={setShowSubtasks}
        />
        <ViewToggle value={viewMode} onChange={setViewMode} />
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
                <EmptyTitle>No tasks yet</EmptyTitle>
                <EmptyDescription>
                  Tasks assigned to you will appear here.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => onNewTask()}>
                  <Plus size={16} />
                  Create Task
                </Button>
              </EmptyContent>
            </Empty>
          }
        >
          {viewMode === 'list' ? (
            <div className='flex-1 overflow-auto'>
              <TaskListTable tasks={filteredTasks} onTaskClick={onTaskClick} />
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
              onAddTask={status => onNewTask(status)}
            />
          )}
        </AsyncContent>
      </div>
    </div>
  )
}

// ─── TaskListTable ─────────────────────────────────────────────────────────────

function TaskListTable({
  tasks,
  onTaskClick,
}: {
  tasks: MyTask[]
  onTaskClick: (task: MyTask) => void
}) {
  const { sort, toggle } = useTableSort<MyTaskSortKey>()

  const sorted = useMemo(() => {
    if (!sort.key) return tasks
    return [...tasks].sort((a, b) => {
      switch (sort.key) {
        case 'title':
          return applyDir(cmpString(a.title, b.title), sort.dir)
        case 'project':
          return applyDir(cmpString(a.project.name, b.project.name), sort.dir)
        case 'status':
          return applyDir(cmpStatus(a.status, b.status), sort.dir)
        case 'priority':
          return applyDir(cmpPriority(a.priority, b.priority), sort.dir)
        case 'updatedAt':
          return applyDir(cmpDate(a.updatedAt, b.updatedAt), sort.dir)
        default:
          return 0
      }
    })
  }, [tasks, sort])

  return (
    <table className='w-full border-collapse'>
      <thead className='sticky top-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm z-10'>
        <tr>
          <SortableHeader
            col='title'
            label='Title'
            sort={sort}
            onToggle={toggle}
            className='text-left py-2 px-8 min-w-[300px]'
          />
          <SortableHeader
            col='project'
            label='Project'
            sort={sort}
            onToggle={toggle}
            className='text-left py-2 px-8 w-40'
          />
          <SortableHeader
            col='status'
            label='Status'
            sort={sort}
            onToggle={toggle}
            className='text-left py-2 px-8 w-32'
          />
          <SortableHeader
            col='priority'
            label='Priority'
            sort={sort}
            onToggle={toggle}
            className='text-left py-2 px-8 w-24'
          />
          <SortableHeader
            col='updatedAt'
            label='Updated'
            sort={sort}
            onToggle={toggle}
            className='text-right py-2 px-8 pr-8'
          />
        </tr>
      </thead>
      <tbody className='divide-y divide-zinc-100 dark:divide-zinc-800'>
        {sorted.map(task => (
          <tr
            key={task.id}
            onClick={() => onTaskClick(task)}
            className='hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors cursor-pointer group'
          >
            <td className='py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800'>
              <span className='text-sm font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-500 transition-colors'>
                {task.title}
              </span>
            </td>
            <td className='py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800'>
              <span className='text-xs text-zinc-500 dark:text-zinc-400'>
                {task.project.name}
              </span>
            </td>
            <td className='py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800'>
              <div className='flex items-center gap-2'>
                <StatusIcon status={task.status} />
                <span className='text-xs text-zinc-600 dark:text-zinc-400'>
                  {API_STATUS_LABEL[task.status] ?? task.status}
                </span>
              </div>
            </td>
            <td className='py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800'>
              <PriorityBadge priority={task.priority} />
            </td>
            <td className='py-2.5 px-8 text-xs text-zinc-400 text-right border-b border-zinc-200 dark:border-zinc-800 pr-8'>
              {new Date(task.updatedAt).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
