'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  Layers,
  Plus,
  MoreHorizontal,
  Trash2,
  MessageSquare,
  GitBranch,
  Star,
  X,
  Loader2,
  Check,
  Link as LinkIcon,
  ExternalLink,
} from 'lucide-react'
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api-client'
import {
  ApiProject,
  ApiRepository,
  ApiTask,
  ApiStatus,
  WorkspaceMemberInfo,
} from '../../types'
import { ReviewerSelect, FIELD_TRIGGER_CLS } from '../fields'
import { ProjectSummaryTab } from '../summary/ProjectSummaryTab'
import { DescriptionEditor } from '../DescriptionEditor'
import { BoardView } from '../board/BoardView'
import { ProjectTaskCard } from '../board/SortableTaskCard'
import { useBoardDrag } from '../../hooks/useBoardDrag'
import { ViewToggle } from '../ViewToggle'
import { DisplayOptionsMenu } from '../DisplayOptionsMenu'
import { useDisplayOptions } from '../../hooks/useDisplayOptions'
import { filterCompletedTasks } from '../../utils/filterCompletedTasks'
import { sortTasks, ORDERING_LABELS } from '../../utils/sortTasks'
import { CACHE_KEY } from '../../constants'
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
import { IDEA_BADGE_CLS } from '../../constants'
import { useBoardSensors } from '../../hooks/useBoardSensors'
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
  currentActorId?: string | null | undefined
  isOwner?: boolean | undefined
  onSlack?: () => void
  onCopyLink?: () => void
  copied?: boolean
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
  currentActorId,
  isOwner,
  onSlack,
  onCopyLink,
  copied,
  workspaceUrl,
}: ProjectDetailPageProps) {
  const [tab, setTab] = useState<'overview' | 'tasks' | 'summary'>('overview')
  const [viewMode, setViewMode] = useState<'list' | 'board'>('board')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const {
    options: displayOptions,
    setCompletedFilter,
    setOrdering,
    setShowSubtasks,
  } = useDisplayOptions(CACHE_KEY.displayProject(project.id))

  const memberNameMap = useMemo(
    () => new Map(members.map(m => [m.clerkId, m.name])),
    [members]
  )
  const getMemberName = useCallback(
    (clerkId: string) => memberNameMap.get(clerkId),
    [memberNameMap]
  )

  const filteredTasks = useMemo(() => {
    let result = filterCompletedTasks(tasks, displayOptions.completedFilter)
    if (!displayOptions.showSubtasks) {
      result = result.filter(t => !t.parentTaskId)
    }
    return sortTasks(result, displayOptions.ordering, undefined, getMemberName)
  }, [
    tasks,
    displayOptions.completedFilter,
    displayOptions.ordering,
    displayOptions.showSubtasks,
    getMemberName,
  ])

  // ── Repositories state ────────────────────────────────────────────────────
  const [repositories, setRepositories] = useState<ApiRepository[]>(
    project.repositories ?? []
  )
  // Sync when parent hydrates repositories from the API (standalone page flow)
  useEffect(() => {
    if (project.repositories) setRepositories(project.repositories)
  }, [project.repositories])
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
    apiFetch<{ repos?: { fullName: string; private: boolean }[] }>(
      `/api/github/repos?workspaceUrl=${workspaceUrl}`
    )
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
        const data = await apiFetch<{ repository: ApiRepository }>(
          `/api/projects/${project.id}/repositories`,
          {
            method: 'POST',
            body: { fullName },
          }
        )
        setRepositories(prev => [...prev, data.repository])
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
        await apiFetch(`/api/projects/${project.id}/repositories/${repoId}`, {
          method: 'PATCH',
          body: { isDefault: true },
        })
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
        await apiFetch(`/api/projects/${project.id}/repositories/${repoId}`, {
          method: 'DELETE',
        })
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
  const sensors = useBoardSensors()

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
              <MessageSquare size={14} />
            </Button>
          )}
          {onCopyLink && (
            <Button
              variant='ghost'
              size='icon'
              onClick={onCopyLink}
              className='h-6 w-6 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              title='Copy link'
            >
              {copied ? <Check size={14} /> : <LinkIcon size={14} />}
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
        {(['overview', 'tasks', 'summary'] as const).map(t => (
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
          <div className='px-4 md:px-8 py-8'>
            {/* Title */}
            <div className='flex items-center gap-1.5 mb-8'>
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

            {/* Two-column layout */}
            <div className='flex gap-10'>
              {/* ── Left: Description ── */}
              <div className='flex-1 min-w-0'>
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

              {/* ── Right: Properties sidebar ── */}
              <div className='w-56 shrink-0 space-y-6'>
                {/* Lead */}
                <div className='space-y-2'>
                  <p className='text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500'>
                    Lead
                  </p>
                  <ReviewerSelect
                    value={project.defaultReviewerId ?? null}
                    onChange={v =>
                      onUpdateProject(project.id, { defaultReviewerId: v })
                    }
                    members={members.filter(
                      (m): m is WorkspaceMemberInfo & { actorId: string } =>
                        m.actorId !== null
                    )}
                    triggerClassName={cn(
                      FIELD_TRIGGER_CLS,
                      'h-7 text-xs w-full'
                    )}
                  />
                </div>

                {/* Repositories */}
                <div className='space-y-2'>
                  <p className='text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500'>
                    Repositories
                  </p>

                  {/* Listed repos */}
                  {repositories.length > 0 && (
                    <ul className='space-y-1.5'>
                      {repositories.map(repo => (
                        <li
                          key={repo.id}
                          className='group flex items-start gap-2 rounded-md px-2 py-1.5 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800'
                        >
                          <GitBranch
                            size={13}
                            className='text-zinc-400 shrink-0 mt-0.5'
                          />
                          <div className='flex-1 min-w-0'>
                            <div className='flex items-center gap-1.5 h-[18px]'>
                              <span className='text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate'>
                                {repo.name}
                              </span>
                              {repo.isDefault && (
                                <span className='inline-flex items-center h-[18px] px-1 rounded text-[10px] leading-none bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 shrink-0'>
                                  Default
                                </span>
                              )}
                            </div>
                            <span className='text-[11px] text-zinc-400 dark:text-zinc-500 font-mono truncate block'>
                              {repo.fullName}
                            </span>
                          </div>
                          <div className='flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0'>
                            <a
                              href={`https://github.com/${repo.fullName}`}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                              title='Open on GitHub'
                            >
                              <ExternalLink size={11} />
                            </a>
                            {!repo.isDefault && (
                              <button
                                onClick={() => handleSetDefault(repo.id)}
                                className='p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                                title='Set as default'
                              >
                                <Star size={11} />
                              </button>
                            )}
                            <button
                              onClick={() => handleRemoveRepo(repo.id)}
                              className='p-0.5 text-zinc-400 hover:text-red-500'
                              title='Remove'
                            >
                              <X size={11} />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Add repository picker */}
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <button className='flex items-center gap-1.5 w-full h-7 px-2 rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-500 transition-colors'>
                        <Plus size={11} />
                        Add repository
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      className='w-64 p-0'
                      align='start'
                      side='bottom'
                    >
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
                                const isLinked = linkedFullNames.has(
                                  repo.fullName
                                )
                                const isAdding = addingRepo === repo.fullName
                                return (
                                  <CommandItem
                                    key={repo.fullName}
                                    value={repo.fullName}
                                    onSelect={() =>
                                      handleAddRepo(repo.fullName)
                                    }
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
                                      <GitBranch
                                        size={12}
                                        className='text-zinc-400 shrink-0'
                                      />
                                    )}
                                    <div className='flex-1 min-w-0'>
                                      <div className='truncate font-medium'>
                                        {repo.fullName.split('/')[1]}
                                      </div>
                                      <div className='truncate text-zinc-400 font-mono'>
                                        {repo.fullName}
                                      </div>
                                    </div>
                                    {repo.private && (
                                      <span className='text-[10px] text-zinc-400 shrink-0'>
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
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Tasks tab ── */}
      {tab === 'summary' && (
        <div className='flex-1 overflow-y-auto'>
          <ProjectSummaryTab projectId={project.id} />
        </div>
      )}

      {tab === 'tasks' && (
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
                  data={filteredTasks}
                  onRowClick={onTaskClick}
                  {...(displayOptions.showSubtasks && {
                    treeConfig: {
                      getParentId: (task: ApiTask) => task.parentTaskId,
                      getChildCount: (task: ApiTask) =>
                        task._count?.children ?? 0,
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
      )}
    </div>
  )
}
