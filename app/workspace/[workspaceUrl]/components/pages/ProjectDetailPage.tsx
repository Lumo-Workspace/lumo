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
import {
  ApiProject,
  ApiTask,
  ApiStatus,
  WorkspaceMemberInfo,
} from '../../types'
import { ReviewerSelect, FIELD_TRIGGER_CLS } from '../TaskFieldSelects'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
import { DND_ACTIVATION_DISTANCE, IDEA_BADGE_CLS } from '../../constants'
import { PageBreadcrumb } from '../PageBreadcrumb'

interface ProjectDetailPageProps {
  project: ApiProject
  tasks: ApiTask[]
  setTasks: React.Dispatch<React.SetStateAction<ApiTask[]>>
  viewId: string | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onBack: () => void
  onNewTask: (status?: ApiStatus) => void
  onTaskClick: (task: ApiTask) => void
  onDeleteTask: (taskId: string) => Promise<void>
  onTaskStatusChanged: (
    taskId: string,
    oldStatus: string,
    newStatus: string
  ) => void
  onUpdateProject: (
    id: string,
    data: {
      name?: string
      description?: string
      defaultReviewerId?: string | null
    }
  ) => Promise<void>
  onDeleteProject: (projectId: string) => Promise<void>
  members: WorkspaceMemberInfo[]
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
  members,
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
    useSensor(PointerSensor, {
      activationConstraint: { distance: DND_ACTIVATION_DISTANCE },
    }),
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
      <PageBreadcrumb>
        <div className='flex items-center gap-1.5'>
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
            </BreadcrumbList>
          </Breadcrumb>
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
            <DropdownMenuContent align='start'>
              <DropdownMenuItem
                className='text-destructive focus:text-destructive'
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className='mr-2 size-4' />
                Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </PageBreadcrumb>

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
      <header className='pt-4 pb-4 px-4 md:px-8 flex items-start justify-between shrink-0'>
        <div className='flex items-start gap-4'>
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
              {project.isIdea && <span className={IDEA_BADGE_CLS}>Draft</span>}
            </div>

            {/* Default lead (project-level reviewer) */}
            <div className='flex items-center gap-1.5 mt-1 -ml-2'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className='text-xs text-zinc-400 pl-2 cursor-default'>
                    Lead
                  </span>
                </TooltipTrigger>
                <TooltipContent side='bottom'>
                  Default reviewer for all tasks in this project.
                  <br />
                  Notified when a task moves to In Review.
                  <br />
                  Can be overridden per task in the task detail.
                </TooltipContent>
              </Tooltip>
              <ReviewerSelect
                value={project.defaultReviewerId ?? null}
                onChange={v =>
                  onUpdateProject(project.id, { defaultReviewerId: v })
                }
                members={members}
                triggerClassName={cn(FIELD_TRIGGER_CLS, 'h-6 text-xs')}
              />
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
        <Button
          onClick={() => onNewTask()}
          size='sm'
          className='gap-1.5 shrink-0'
        >
          <Plus size={18} />
          Create Task
        </Button>
      </header>

      {/* Toolbar */}
      <div className='h-12 flex items-center justify-end px-4 md:px-8 shrink-0 bg-white dark:bg-zinc-950'>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      {/* Content */}
      <div className='flex-1 flex flex-col overflow-hidden'>
        <AsyncContent
          loading={loading}
          error={error}
          empty={tasks.length === 0 && viewMode !== 'board'}
          onRetry={onRetry}
          className='flex-1 flex flex-col overflow-hidden'
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
              <DataTable
                columns={taskColumns}
                data={tasks}
                onRowClick={onTaskClick}
              />
            </div>
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
                  members={members}
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
