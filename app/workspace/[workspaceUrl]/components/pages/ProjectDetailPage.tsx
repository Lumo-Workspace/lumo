'use client'

import { useState, useMemo, useCallback } from 'react'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/utils'
import { slugify } from '@/lib/utils/slugify'
import { useWorkspace } from '../../hooks/useWorkspace'
import {
  ApiProject,
  ApiTask,
  ApiStatus,
  WorkspaceMemberInfo,
} from '../../types'
import { ProjectSignalTab } from '../signal/ProjectSignalTab'
import { useBoardDrag } from '../../hooks/useBoardDrag'
import { useDisplayOptions } from '../../hooks/useDisplayOptions'
import { filterCompletedTasks } from '../../utils/filterCompletedTasks'
import { sortTasks } from '../../utils/sortTasks'
import { CACHE_KEY } from '../../constants'
import { useBoardSensors } from '../../hooks/useBoardSensors'
import { ProjectHeader } from './project-detail/ProjectHeader'
import { ProjectOverviewTab } from './project-detail/ProjectOverviewTab'
import { ProjectTasksTab } from './project-detail/ProjectTasksTab'
import { ProjectMilestonesTab } from '../milestones/ProjectMilestonesTab'
import { MemoryTab } from '../memory/MemoryTab'

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
      ownerId?: string | null
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
  const [tab, setTab] = useState<
    'overview' | 'milestones' | 'tasks' | 'signal' | 'memory'
  >('overview')
  const [viewMode, setViewMode] = useState<'list' | 'board'>('board')
  const intl = useIntl()

  // Workspace risk defaults for project-level overrides — sourced from the
  // shared, RQ-cached workspace metadata. Stays null until the real fetch
  // resolves (the localStorage placeholder carries no risk fields), so the
  // risk card mounts only once true defaults are known — same as before.
  const { workspace: ws, isPlaceholder: wsIsPlaceholder } = useWorkspace()
  const workspaceRiskDefaults = useMemo(() => {
    if (!ws || wsIsPlaceholder) return null
    return {
      riskOverdueRatio: ws.riskOverdueRatio ?? 0.3,
      riskStalledDays: ws.riskStalledDays ?? 7,
      riskStalledMinCount: ws.riskStalledMinCount ?? 3,
      riskAgentFailRatio: ws.riskAgentFailRatio ?? 0.3,
      riskStalePrDays: ws.riskStalePrDays ?? 3,
      riskThroughputDrop: ws.riskThroughputDrop ?? 0.5,
    }
  }, [ws, wsIsPlaceholder])

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

  // WorkspaceMember.id → display name for the Memory tab's "Added by X"
  // (memory.createdByMemberId is a WorkspaceMember.id, not a clerkId).
  const memoryMemberNames = useMemo(
    () => new Map(members.map(m => [m.id, m.name])),
    [members]
  )

  // The Signal tab hands back a task id (that is all its blocker rows carry);
  // resolve it to the task the detail pane expects.
  const openTaskById = useCallback(
    (taskId: string) => {
      const task = tasks.find(t => t.id === taskId)
      if (task) onTaskClick(task)
    },
    [tasks, onTaskClick]
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
        projectId={project.id}
        projectName={project.name}
        onBack={onBack}
        onDeleteProject={onDeleteProject}
        onSlack={onSlack}
        onCopyLink={onCopyLink}
        copied={copied}
      />

      {/* Tab nav */}
      <div className='flex items-center gap-1 px-4 md:px-8 mt-4 shrink-0'>
        {(['overview', 'milestones', 'tasks', 'signal', 'memory'] as const).map(
          t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-1.5 text-sm font-medium capitalize rounded-md transition-colors',
                tab === t
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              {intl.formatMessage({
                id: `project.tab.${t}`,
                defaultMessage: t.charAt(0).toUpperCase() + t.slice(1),
              })}
            </button>
          )
        )}
      </div>

      {/* ── Overview tab ── */}
      {tab === 'overview' && (
        <ProjectOverviewTab
          project={project}
          members={members}
          workspaceUrl={workspaceUrl}
          workspaceRiskDefaults={workspaceRiskDefaults}
          onUpdateProject={onUpdateProject}
        />
      )}

      {/* ── Milestones tab ── */}
      {tab === 'milestones' && (
        <div className='flex-1 overflow-y-auto'>
          <ProjectMilestonesTab
            projectId={project.id}
            projectSlug={slugify(project.name)}
          />
        </div>
      )}

      {/* ── Signal tab ── */}
      {tab === 'signal' && (
        <div className='flex-1 overflow-y-auto'>
          <ProjectSignalTab projectId={project.id} onOpenTask={openTaskById} />
        </div>
      )}

      {/* ── Memory tab ── */}
      {tab === 'memory' && (
        <div className='flex-1 overflow-y-auto px-4 md:px-8 py-6'>
          <MemoryTab
            scope='project'
            parentId={project.id}
            enabled
            memberNames={memoryMemberNames}
          />
        </div>
      )}

      {/* ── Tasks tab ── */}
      {tab === 'tasks' && (
        <ProjectTasksTab
          projectId={project.id}
          tasks={tasks}
          setTasks={setTasks}
          filteredTasks={filteredTasks}
          loading={loading}
          error={error}
          onRetry={onRetry}
          onNewTask={onNewTask}
          onTaskClick={onTaskClick}
          onDeleteTask={onDeleteTask}
          members={members}
          currentActorId={currentActorId}
          isOwner={isOwner}
          viewMode={viewMode}
          setViewMode={setViewMode}
          displayOptions={displayOptions}
          setCompletedFilter={setCompletedFilter}
          setOrdering={setOrdering}
          setShowSubtasks={setShowSubtasks}
          sensors={sensors}
          activeId={activeId}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        />
      )}
    </div>
  )
}
