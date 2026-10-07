'use client'

import { useState, useMemo, useCallback } from 'react'
import { useIntl } from 'react-intl'
import {
  Brain,
  Flag,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { slugify } from '@/lib/utils/slugify'
import { buildSignalView } from '@/lib/summaries/signal-view'
import {
  ApiProject,
  ApiTask,
  ApiStatus,
  WorkspaceMemberInfo,
} from '../../types'
import { useProjectRealtimeStats } from '../../hooks/useRealtimeStats'
import { useBoardDrag } from '../../hooks/useBoardDrag'
import { useDisplayOptions } from '../../hooks/useDisplayOptions'
import { filterCompletedTasks } from '../../utils/filterCompletedTasks'
import { sortTasks } from '../../utils/sortTasks'
import { CACHE_KEY } from '../../constants'
import { useBoardSensors } from '../../hooks/useBoardSensors'
import { ProjectHeader } from './project-detail/ProjectHeader'
import { ProjectTab } from './project-detail/ProjectTab'
import { ProjectTasksTab } from './project-detail/ProjectTasksTab'
import { ProjectMilestonesTab } from '../milestones/ProjectMilestonesTab'
import { MemoryTab } from '../memory/MemoryTab'

const TABS = ['project', 'milestones', 'tasks', 'memory'] as const
type ProjectTabKey = (typeof TABS)[number]

/**
 * One icon per tab, picked to stay clear of the vocabulary the workspace nav
 * already spends: `Target` is Initiatives, `File`/`FileEdit` are Documents and
 * Drafts. `Brain` is reused deliberately — it is already
 * the Memory surface's own icon.
 */
const TAB_ICONS: Record<ProjectTabKey, LucideIcon> = {
  project: LayoutDashboard,
  milestones: Flag,
  tasks: ListChecks,
  memory: Brain,
}

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
  const [tab, setTab] = useState<ProjectTabKey>('project')
  const [viewMode, setViewMode] = useState<'list' | 'board'>('board')
  const intl = useIntl()

  // Health signals are fetched here rather than inside the Project tab so the
  // data survives tab switches — returning to Project shows the row it had,
  // instead of a skeleton while an identical request runs again.
  const {
    stats,
    loading: statsLoading,
    error: statsError,
  } = useProjectRealtimeStats(project.id)

  const view = useMemo(() => (stats ? buildSignalView(stats) : null), [stats])

  const {
    options: displayOptions,
    setCompletedFilter,
    setOrdering,
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

  // The health row hands back a task id (that is all its blocker rows carry);
  // resolve it to the task the detail pane expects.
  const openTaskById = useCallback(
    (taskId: string) => {
      const task = tasks.find(t => t.id === taskId)
      if (task) onTaskClick(task)
    },
    [tasks, onTaskClick]
  )

  const filteredTasks = useMemo(() => {
    const result = filterCompletedTasks(tasks, displayOptions.completedFilter)
    return sortTasks(result, displayOptions.ordering, undefined, getMemberName)
  }, [
    tasks,
    displayOptions.completedFilter,
    displayOptions.ordering,
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

      {/* Tab nav — a segmented control: one recessed track with the current tab
          raised out of it. The four tabs are a closed set of views onto the same
          project, and a track says "pick one of these" in a way four loose
          buttons don't. */}
      <div className='mt-4 shrink-0 px-4 md:px-8'>
        <div
          role='tablist'
          className='inline-flex items-center gap-1 rounded-lg bg-muted p-1'
        >
          {TABS.map(t => {
            const Icon = TAB_ICONS[t]
            const selected = tab === t
            return (
              <button
                key={t}
                role='tab'
                aria-selected={selected}
                onClick={() => setTab(t)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                  selected
                    ? 'bg-background text-foreground shadow-elevation-1'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className='size-3.5 shrink-0' aria-hidden />
                {intl.formatMessage({ id: `project.tab.${t}` })}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Project tab ── */}
      {tab === 'project' && (
        <ProjectTab
          project={project}
          projectSlug={slugify(project.name)}
          members={members}
          workspaceUrl={workspaceUrl}
          view={view}
          stalled={stats?.topBlockers.stalledTaskIds ?? []}
          highStakes={stats?.topBlockers.highStakesTaskIds ?? []}
          stalePrs={stats?.topBlockers.staleOpenPrs ?? []}
          statsLoading={statsLoading}
          statsError={statsError}
          onUpdateProject={onUpdateProject}
          onOpenTask={openTaskById}
          onViewAllTasks={() => setTab('tasks')}
          onViewAllMilestones={() => setTab('milestones')}
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
