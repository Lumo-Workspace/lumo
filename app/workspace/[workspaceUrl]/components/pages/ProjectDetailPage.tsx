'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { Layers, Plus, MoreHorizontal, Trash2 } from 'lucide-react'
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
import { BoardView } from '../board/BoardView'
import { ProjectTaskCard } from '../board/SortableTaskCard'
import { useBoardDrag } from '../../hooks/useBoardDrag'
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
import { DataTable } from '../data-table/data-table'
import { createTaskColumns } from '../data-table/task-columns'
import { TypographyH3 } from '@/components/ui/typography'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

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
  onDeleteTask: (taskId: string) => Promise<void>
  onTaskStatusChanged: (
    taskId: string,
    oldStatus: string,
    newStatus: string
  ) => void
  onUpdateProject: (
    id: string,
    data: { name?: string; description?: string }
  ) => Promise<void>
  onDeleteProject: (projectId: string) => Promise<void>
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
  onDeleteTask,
  onTaskStatusChanged,
  onUpdateProject,
  onDeleteProject,
}: ProjectDetailPageProps) {
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list')
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Memoised columns — stable reference so TanStack Table doesn't re-create on every render
  const taskColumns = useMemo(
    () => createTaskColumns(onTaskClick, onDeleteTask),
    [onTaskClick, onDeleteTask]
  )

  // ─── Inline editing state ────────────────────────────────────────────────────
  const [editingDesc, setEditingDesc] = useState(false)
  const [descValue, setDescValue] = useState(project.description ?? '')
  const descRef = useRef<HTMLTextAreaElement>(null)

  // Keep description in sync when project prop changes
  useEffect(() => {
    setDescValue(project.description ?? '')
  }, [project.description])

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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-6 w-6 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                  >
                    <MoreHorizontal size={14} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem
                    className='text-destructive focus:text-destructive'
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className='mr-2 size-4' />
                    Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogMedia className='bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive'>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{project.name}&rdquo; and all its tasks will be permanently
              deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant='outline'>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => onDeleteProject(project.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Page header */}
      <header className='pb-4 px-8 flex items-start justify-between shrink-0'>
        <div className='flex items-start gap-4'>
          <div className='size-10 flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800'>
            <Layers size={18} className='text-zinc-500' />
          </div>
          <div>
            <div className='flex items-center gap-1'>
              {/* Inline name editor */}
              <TypographyH3
                key={project.id}
                contentEditable
                suppressContentEditableWarning
                onBlur={e => {
                  const trimmed = e.currentTarget.textContent?.trim() ?? ''
                  if (!trimmed || trimmed === project.name) {
                    e.currentTarget.textContent = project.name
                    return
                  }
                  onUpdateProject(project.id, { name: trimmed })
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.currentTarget.blur()
                  }
                  if (e.key === 'Escape') {
                    e.currentTarget.textContent = project.name
                    e.currentTarget.blur()
                  }
                }}
                className='outline-none cursor-text focus:outline-none'
              >
                {project.name}
              </TypographyH3>
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
        <Button onClick={onNewTask} size='sm' className='gap-1.5'>
          <Plus size={18} />
          Create Task
        </Button>
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
            <DataTable
              columns={taskColumns}
              data={tasks}
              onRowClick={onTaskClick}
            />
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
