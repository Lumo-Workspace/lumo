'use client'

import { useMemo, useCallback } from 'react'
import { Layers, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ApiProject,
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
import { IDEA_BADGE_CLS } from '../../constants'
import { useBoardSensors } from '../../hooks/useBoardSensors'
import { useProjectViewState } from '../../hooks/useProjectViewState'
import { ProjectHeader } from '../ProjectHeader'
import { RepositoriesSection } from '../RepositoriesSection'

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
  const {
    tab,
    setTab,
    viewMode,
    setViewMode,
    deleteOpen,
    setDeleteOpen,
    repositories,
    pickerOpen,
    setPickerOpen,
    availableRepos,
    reposLoading,
    githubConnected,
    addingRepo,
    linkedFullNames,
    handleAddRepo,
    handleSetDefault,
    handleRemoveRepo,
  } = useProjectViewState({
    projectId: project.id,
    initialRepositories: project.repositories,
    workspaceUrl,
  })

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
      <ProjectHeader
        projectName={project.name}
        projectId={project.id}
        deleteOpen={deleteOpen}
        onDeleteOpenChange={setDeleteOpen}
        onBack={onBack}
        onDeleteProject={onDeleteProject}
        onSlack={onSlack}
        onCopyLink={onCopyLink}
        copied={copied}
      />

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
                <RepositoriesSection
                  repositories={repositories}
                  pickerOpen={pickerOpen}
                  onPickerOpenChange={setPickerOpen}
                  availableRepos={availableRepos}
                  reposLoading={reposLoading}
                  githubConnected={githubConnected}
                  addingRepo={addingRepo}
                  linkedFullNames={linkedFullNames}
                  onAddRepo={handleAddRepo}
                  onSetDefault={handleSetDefault}
                  onRemoveRepo={handleRemoveRepo}
                  workspaceUrl={workspaceUrl}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Summary tab ── */}
      {tab === 'summary' && (
        <div className='flex-1 overflow-y-auto'>
          <ProjectSummaryTab projectId={project.id} />
        </div>
      )}

      {/* ── Tasks tab ── */}
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
