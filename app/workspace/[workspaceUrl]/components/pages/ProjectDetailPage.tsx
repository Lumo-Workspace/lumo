'use client'

import { useState, useMemo, useCallback } from 'react'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { slugify } from '@/lib/utils/slugify'
import { buildSignalView } from '@/lib/summaries/signal-view'
import { resolveLocale } from '@/lib/i18n/locales'
import {
  ApiProject,
  ApiTask,
  ApiStatus,
  ProjectUpdateFields,
  WorkspaceMemberInfo,
} from '../../types'
import { useProjectRealtimeStats } from '../../hooks/useRealtimeStats'
import { useBoardDrag } from '../../hooks/useBoardDrag'
import { useDisplayOptions } from '../../hooks/useDisplayOptions'
import { filterCompletedTasks } from '../../utils/filterCompletedTasks'
import { sortTasks } from '../../utils/sortTasks'
import { CACHE_KEY } from '../../constants'
import { useBoardSensors } from '../../hooks/useBoardSensors'
import { usePreferences } from '../../hooks/usePreferences'
import type { Preferences } from '../../hooks/usePreferences'
import { ProjectHeader } from './project-detail/ProjectHeader'
import { ProjectTab } from './project-detail/ProjectTab'
import {
  ProjectDetailTabs,
  type ProjectTabKey,
} from './project-detail/ProjectDetailTabs'
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
  onUpdateProject: (id: string, data: ProjectUpdateFields) => Promise<void>
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
  const intl = useIntl()
  const [tab, setTab] = useState<ProjectTabKey>('project')
  const [viewMode, setViewMode] = useState<'list' | 'board'>('board')

  // The header's language switcher is a shortcut to the same personal
  // preference the Preferences page writes — not a project-scoped setting.
  // Owning the read/write here keeps ProjectHeader presentational.
  const { prefs, updatePreferences } = usePreferences()
  const handleLocaleChange = useCallback(
    (locale: string) => {
      // A failed save is already surfaced (toast + rollback) by the hook;
      // catching here only keeps the rejection from going unhandled.
      updatePreferences({ locale: locale as Preferences['locale'] }).catch(
        () => {}
      )
    },
    [updatePreferences]
  )

  // LUM-1285: archive / unarchive from the header menu. The sidebar drops an
  // archived project, so confirm the move with a toast either way.
  const handleArchivedChange = useCallback(
    async (archived: boolean) => {
      try {
        await onUpdateProject(project.id, { archived })
        toast.success(
          intl.formatMessage({
            id: archived ? 'project.archivedToast' : 'project.unarchivedToast',
          })
        )
      } catch (err) {
        toast.error(
          err instanceof Error && err.message
            ? err.message
            : intl.formatMessage({ id: 'project.updateFailed' })
        )
      }
    },
    [onUpdateProject, project.id, intl]
  )

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
        archived={Boolean(project.archivedAt)}
        onArchivedChange={handleArchivedChange}
        onSlack={onSlack}
        onCopyLink={onCopyLink}
        copied={copied}
        locale={resolveLocale(prefs.locale)}
        onLocaleChange={handleLocaleChange}
      />

      <ProjectDetailTabs value={tab} onValueChange={setTab} />

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
