'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  Layers,
  Plus,
  MoreHorizontal,
  Trash2,
  Slack,
  Github,
  Star,
  X,
  Loader2,
  Check,
  ChevronsUpDown,
} from 'lucide-react'
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
  ApiRepository,
  ApiTask,
  ApiStatus,
  WorkspaceMemberInfo,
} from '../../types'
import { ReviewerSelect, FIELD_TRIGGER_CLS } from '../TaskFieldSelects'
import { DescriptionEditor } from '../DescriptionEditor'
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

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
  onSlack?: () => void
  workspaceUrl: string
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
  onSlack,
  workspaceUrl,
}: ProjectDetailPageProps) {
  const [tab, setTab] = useState<'overview' | 'tasks'>('overview')
  const [viewMode, setViewMode] = useState<'list' | 'board'>('board')
  const [deleteOpen, setDeleteOpen] = useState(false)

  // ── Repositories state ────────────────────────────────────────────────────
  const [repositories, setRepositories] = useState<ApiRepository[]>(
    project.repositories ?? []
  )
  const [pickerOpen, setPickerOpen] = useState(false)
  const [availableRepos, setAvailableRepos] = useState<
    { fullName: string; private: boolean }[]
  >([])
  const [reposLoading, setReposLoading] = useState(false)
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null)
  const [addingRepo, setAddingRepo] = useState<string | null>(null)

  // Fetch available repos from GitHub when picker opens
  useEffect(() => {
    if (!pickerOpen) return
    setReposLoading(true)
    fetch(`/api/github/repos?workspaceUrl=${workspaceUrl}`)
      .then(r => r.json())
      .then(data => {
        if (data.repos) {
          setAvailableRepos(data.repos)
          setGithubConnected(true)
        } else {
          setGithubConnected(false)
        }
      })
      .catch(() => setGithubConnected(false))
      .finally(() => setReposLoading(false))
  }, [pickerOpen, workspaceUrl])

  const linkedFullNames = new Set(repositories.map(r => r.fullName))

  const handleAddRepo = useCallback(
    async (fullName: string) => {
      if (linkedFullNames.has(fullName)) return
      setAddingRepo(fullName)
      try {
        const res = await fetch(`/api/projects/${project.id}/repositories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName }),
        })
        const data = await res.json()
        if (!res.ok) return
        setRepositories(prev => [...prev, data.repository as ApiRepository])
        setPickerOpen(false)
      } finally {
        setAddingRepo(null)
      }
    },

    [project.id, linkedFullNames]
  )

  const handleSetDefault = useCallback(
    async (repoId: string) => {
      try {
        const res = await fetch(
          `/api/projects/${project.id}/repositories/${repoId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isDefault: true }),
          }
        )
        if (!res.ok) return
        setRepositories(prev =>
          prev.map(r => ({ ...r, isDefault: r.id === repoId }))
        )
      } catch {
        // ignore
      }
    },
    [project.id]
  )

  const handleRemoveRepo = useCallback(
    async (repoId: string) => {
      try {
        const res = await fetch(
          `/api/projects/${project.id}/repositories/${repoId}`,
          { method: 'DELETE' }
        )
        if (!res.ok) return
        setRepositories(prev => prev.filter(r => r.id !== repoId))
      } catch {
        // ignore
      }
    },
    [project.id]
  )

  // Memoised columns — stable reference so TanStack Table doesn't re-create on every render
  const taskColumns = useMemo(
    () => createTaskColumns(onTaskClick, onDeleteTask),
    [onTaskClick, onDeleteTask]
  )

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
          {onSlack && (
            <Button
              variant='ghost'
              size='icon'
              onClick={onSlack}
              className='h-6 w-6 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              title='Slack notifications'
            >
              <Slack size={14} />
            </Button>
          )}
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

      {/* Tab nav */}
      <div className='flex items-center gap-1 px-4 md:px-8 mt-4 shrink-0'>
        {(['overview', 'tasks'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-1.5 text-sm font-medium capitalize rounded-md transition-colors',
              tab === t
                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
            )}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {tab === 'overview' && (
        <div className='flex-1 overflow-y-auto'>
          <div className='px-4 md:px-8 py-8 space-y-6'>
            {/* Title */}
            <div className='flex items-center gap-1.5'>
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
            {/* Properties */}
            <div className='space-y-1'>
              <p className='text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3'>
                Properties
              </p>
              <div className='flex items-center gap-2 py-1'>
                <ReviewerSelect
                  value={project.defaultReviewerId ?? null}
                  onChange={v =>
                    onUpdateProject(project.id, { defaultReviewerId: v })
                  }
                  members={members}
                  triggerClassName={cn(FIELD_TRIGGER_CLS, 'h-6 text-xs')}
                />
              </div>
            </div>

            {/* Repositories */}
            <div className='space-y-2'>
              <p className='text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500'>
                Repositories
              </p>
              {repositories.length > 0 && (
                <ul className='space-y-1'>
                  {repositories.map(repo => (
                    <li
                      key={repo.id}
                      className='flex items-center gap-2 text-sm'
                    >
                      <Github size={13} className='text-zinc-400 shrink-0' />
                      <span className='flex-1 font-mono text-xs text-zinc-700 dark:text-zinc-300'>
                        {repo.fullName}
                      </span>
                      {repo.isDefault ? (
                        <span className='text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500'>
                          default
                        </span>
                      ) : (
                        <button
                          onClick={() => handleSetDefault(repo.id)}
                          className='text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
                          title='Set as default'
                        >
                          <Star size={12} />
                        </button>
                      )}
                      <button
                        onClick={() => handleRemoveRepo(repo.id)}
                        className='text-zinc-400 hover:text-red-500'
                        title='Remove'
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <button className='flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-border bg-background text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors'>
                    <Plus size={11} />
                    Add repository
                    <ChevronsUpDown size={10} className='opacity-50 ml-0.5' />
                  </button>
                </PopoverTrigger>
                <PopoverContent className='w-72 p-0' align='start'>
                  {reposLoading ? (
                    <div className='flex items-center justify-center py-6 gap-2 text-xs text-muted-foreground'>
                      <Loader2 size={13} className='animate-spin' />
                      Loading repositories…
                    </div>
                  ) : githubConnected === false ? (
                    <div className='px-3 py-4 text-xs text-muted-foreground text-center space-y-1'>
                      <p>GitHub is not connected.</p>
                      <p>
                        Go to{' '}
                        <a
                          href={`/workspace/${workspaceUrl}/settings`}
                          className='text-blue-500 underline'
                        >
                          Settings
                        </a>{' '}
                        to connect GitHub.
                      </p>
                    </div>
                  ) : (
                    <Command>
                      <CommandInput
                        placeholder='Search repositories…'
                        className='text-xs h-8'
                      />
                      <CommandList>
                        <CommandEmpty className='py-4 text-xs text-center text-muted-foreground'>
                          No repositories found.
                        </CommandEmpty>
                        <CommandGroup>
                          {availableRepos.map(repo => {
                            const isLinked = linkedFullNames.has(repo.fullName)
                            const isAdding = addingRepo === repo.fullName
                            return (
                              <CommandItem
                                key={repo.fullName}
                                value={repo.fullName}
                                onSelect={() => handleAddRepo(repo.fullName)}
                                disabled={isLinked}
                                className='flex items-center gap-2 text-xs'
                              >
                                {isAdding ? (
                                  <Loader2
                                    size={12}
                                    className='animate-spin shrink-0'
                                  />
                                ) : isLinked ? (
                                  <Check
                                    size={12}
                                    className='text-green-500 shrink-0'
                                  />
                                ) : (
                                  <Github
                                    size={12}
                                    className='text-zinc-400 shrink-0'
                                  />
                                )}
                                <span className='flex-1 truncate font-mono'>
                                  {repo.fullName}
                                </span>
                                {repo.private && (
                                  <span className='text-[10px] text-zinc-400'>
                                    private
                                  </span>
                                )}
                              </CommandItem>
                            )
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            {/* Description */}
            <div>
              <p className='text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3'>
                Description
              </p>
              <DescriptionEditor
                key={project.id}
                value={project.description}
                onCommit={html => {
                  onUpdateProject(project.id, { description: html ?? '' })
                }}
                placeholder='Add a description…'
                members={members}
                documentId={project.id}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Tasks tab ── */}
      {tab === 'tasks' && (
        <div className='flex-1 flex flex-col overflow-hidden'>
          {/* Toolbar */}
          <div className='h-12 flex items-center justify-end px-4 md:px-8 shrink-0'>
            <ViewToggle value={viewMode} onChange={setViewMode} />
          </div>

          {/* Content */}
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
      )}
    </div>
  )
}
