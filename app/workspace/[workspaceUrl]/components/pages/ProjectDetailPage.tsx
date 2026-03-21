'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { Layers, Plus, MoreHorizontal } from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { cn } from '@/lib/utils'
import { ApiProject, ApiTask } from '../../types'
import { API_STATUS_LABEL } from '../../utils'
import { StatusIcon } from '../StatusIcon'
import { PriorityBadge } from '../PriorityBadge'
import { BoardView } from '../board/BoardView'
import { ProjectTaskCard } from '../board/SortableTaskCard'
import { useBoardDrag } from '../../hooks/useBoardDrag'
import { SortableHeader } from '../SortableHeader'
import { ViewToggle } from '../ViewToggle'
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

type TaskSortKey = 'title' | 'status' | 'priority' | 'updatedAt'

interface ProjectDetailPageProps {
  project: ApiProject
  tasks: ApiTask[]
  setTasks: React.Dispatch<React.SetStateAction<ApiTask[]>>
  viewId: string | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onBack: () => void
  onNewTask: () => void
  onTaskClick: (task: ApiTask) => void
  onTaskStatusChanged: (
    taskId: string,
    oldStatus: string,
    newStatus: string
  ) => void
  onUpdateProject: (
    id: string,
    data: { name?: string; description?: string }
  ) => Promise<void>
}

export function ProjectDetailPage({
  project,
  tasks,
  setTasks,
  viewId,
  loading,
  error,
  onRetry,
  onBack,
  onNewTask,
  onTaskClick,
  onTaskStatusChanged,
  onUpdateProject,
}: ProjectDetailPageProps) {
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list')

  // ─── Inline editing state ────────────────────────────────────────────────────
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(project.name)
  const [editingDesc, setEditingDesc] = useState(false)
  const [descValue, setDescValue] = useState(project.description ?? '')
  const nameRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)

  // Keep local values in sync when project prop changes (e.g. after save)
  useEffect(() => {
    setNameValue(project.name)
    setDescValue(project.description ?? '')
  }, [project.name, project.description])

  const commitName = async () => {
    setEditingName(false)
    const trimmed = nameValue.trim()
    if (!trimmed || trimmed === project.name) {
      setNameValue(project.name)
      return
    }
    await onUpdateProject(project.id, { name: trimmed })
  }

  const commitDesc = async () => {
    setEditingDesc(false)
    const trimmed = descValue.trim()
    if (trimmed === (project.description ?? '')) return
    await onUpdateProject(project.id, { description: trimmed })
  }

  // ─── DnD ────────────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const { activeId, onDragStart, onDragOver, onDragEnd } = useBoardDrag({
    tasks,
    setTasks,
    viewId,
    onStatusChanged: onTaskStatusChanged,
  })

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Breadcrumb */}
      <div className='px-8 pt-6 mb-3'>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <button onClick={onBack}>Projects</button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{project.name}</BreadcrumbPage>
            </BreadcrumbItem>
            <BreadcrumbItem>
              <button className='text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors p-0.5 rounded'>
                <MoreHorizontal size={14} />
              </button>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Page header */}
      <header className='pb-4 px-8 flex items-start justify-between shrink-0'>
        <div className='flex items-start gap-4'>
          <div className='size-10 flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800'>
            <Layers size={18} className='text-zinc-500' />
          </div>
          <div>
            <div className='flex items-center gap-1'>
              {/* Inline name editor — always an input to avoid layout shift */}
              <input
                ref={nameRef}
                value={nameValue}
                onChange={e => setNameValue(e.target.value)}
                onFocus={() => setEditingName(true)}
                onBlur={commitName}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitName()
                  }
                  if (e.key === 'Escape') {
                    setNameValue(project.name)
                    setEditingName(false)
                    nameRef.current?.blur()
                  }
                }}
                className={cn(
                  'text-xl font-semibold tracking-tight bg-transparent border-none outline-none min-w-[120px] transition-colors',
                  editingName
                    ? ''
                    : 'cursor-text hover:text-zinc-600 dark:hover:text-zinc-300'
                )}
                style={{ width: `${Math.max(nameValue.length, 8)}ch` }}
              />
              {project.isIdea && (
                <span className='text-[10px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 font-medium border border-amber-200 dark:border-amber-800'>
                  Draft
                </span>
              )}
            </div>

            {/* Inline description editor — always a textarea to avoid layout shift */}
            <textarea
              ref={descRef}
              value={descValue}
              placeholder='Add a summary…'
              rows={1}
              onChange={e => setDescValue(e.target.value)}
              onFocus={() => setEditingDesc(true)}
              onBlur={commitDesc}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setDescValue(project.description ?? '')
                  setEditingDesc(false)
                  descRef.current?.blur()
                }
              }}
              className={cn(
                'mt-0.5 text-sm bg-transparent outline-none resize-none w-full leading-relaxed transition-colors border-none',
                editingDesc
                  ? 'text-zinc-500'
                  : 'text-zinc-500 cursor-text hover:text-zinc-700 dark:hover:text-zinc-300',
                !descValue &&
                  'placeholder:text-zinc-300 dark:placeholder:text-zinc-600'
              )}
            />
          </div>
        </div>
        <button
          onClick={onNewTask}
          className='bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-semibold px-4 py-2 rounded-md hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center gap-1.5 shadow-sm'
        >
          <Plus size={18} />
          Create Task
        </button>
      </header>

      {/* Toolbar */}
      <div className='h-12 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-end px-8 shrink-0 bg-white dark:bg-zinc-950'>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      {/* Content */}
      <div className='flex-1 overflow-auto'>
        <AsyncContent
          loading={loading}
          error={error}
          empty={tasks.length === 0}
          onRetry={onRetry}
          emptyState={
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <Layers />
                </EmptyMedia>
                <EmptyTitle>No tasks yet</EmptyTitle>
                <EmptyDescription>
                  This project has no tasks. Add the first one to get started.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={onNewTask}>
                  <Plus size={16} />
                  Create Task
                </Button>
              </EmptyContent>
            </Empty>
          }
        >
          {viewMode === 'list' ? (
            <TaskListTable tasks={tasks} onTaskClick={onTaskClick} />
          ) : (
            <BoardView
              tasks={tasks}
              sensors={sensors}
              activeId={activeId}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              renderCard={(task, isOverlay) => (
                <ProjectTaskCard
                  key={task.id}
                  task={task}
                  isOverlay={isOverlay}
                  onClick={() => onTaskClick(task)}
                />
              )}
              onAddTask={onNewTask}
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
  tasks: ApiTask[]
  onTaskClick: (task: ApiTask) => void
}) {
  const { sort, toggle } = useTableSort<TaskSortKey>()

  const sorted = useMemo(() => {
    if (!sort.key) return tasks
    return [...tasks].sort((a, b) => {
      switch (sort.key) {
        case 'title':
          return applyDir(cmpString(a.title, b.title), sort.dir)
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
              <div className='flex items-center gap-2'>
                {task.parentTaskId != null && (
                  <span className='w-3 h-px bg-zinc-300 dark:bg-zinc-700 inline-block' />
                )}
                <span className='text-sm font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors'>
                  {task.title}
                </span>
              </div>
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
