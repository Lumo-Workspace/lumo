'use client'

import { useCallback, useRef, Dispatch, SetStateAction } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type {
  ApiTask,
  ApiProject,
  ApiStatus,
  ApiPriority,
  MyTask,
  TaskDetail,
} from '../types'
import { apiFetchQuiet, tasksClient, projectsClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { NewTaskFormData } from '../components/modals/NewTaskModal'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'

// ── Types ───────────────────────────────────────────────────────────────────

interface Member {
  id: string
  clerkId: string
  actorId: string | null
  role: string
}

interface UseWorkspaceTaskHandlersOptions {
  // List setters from useMyTasks / useProjectTasks (write into TanStack cache).
  myTasks: MyTask[]
  setMyTasks: Dispatch<SetStateAction<MyTask[]>>
  projectTasks: ApiTask[]
  setProjectTasks: Dispatch<SetStateAction<ApiTask[]>>

  // Members
  members: Member[]
  currentMemberId: string | undefined

  // Projects
  projects: ApiProject[]
  setProjects: Dispatch<SetStateAction<ApiProject[]>>
  selectedProject: ApiProject | null
  fetchProjects: () => void
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useWorkspaceTaskHandlers({
  myTasks,
  setMyTasks,
  projectTasks,
  setProjectTasks,
  members,
  currentMemberId,
  projects,
  setProjects,
  selectedProject,
  fetchProjects,
}: UseWorkspaceTaskHandlersOptions) {
  const intl = useIntl()
  const queryClient = useQueryClient()

  // description cache: taskId → description html (populated after first fetch)
  const descriptionCache = useRef<Map<string, string | null>>(new Map())

  const handleOpenTask = useCallback((task: ApiTask | MyTask) => {
    // Members come from the shared useMembers cache (fetched once on workspace
    // mount); no per-open refetch needed.
    return task // caller sets selectedTask
  }, [])

  const patchListItem = useCallback(
    (taskId: string, patch: Record<string, unknown>): void => {
      setMyTasks(prev =>
        prev.map(t => (t.id === taskId ? ({ ...t, ...patch } as MyTask) : t))
      )
      setProjectTasks(prev =>
        prev.map(t => (t.id === taskId ? ({ ...t, ...patch } as ApiTask) : t))
      )
    },
    [setMyTasks, setProjectTasks]
  )

  const handleUpdateTask = useCallback(
    async (
      taskId: string,
      data: Partial<{
        title: string
        status: ApiStatus
        assigneeActorId: string | null
        description: string | null
        projectId: string
        priority: ApiPriority
        dueDate: string | null
      }>
    ) => {
      // Optimistic list-cache + per-task detail-cache patches.
      patchListItem(taskId, data as Record<string, unknown>)
      queryClient.setQueryData<TaskDetail>(
        queryKeys.tasks.detail(taskId),
        prev => (prev ? ({ ...prev, ...data } as TaskDetail) : prev)
      )

      if ('projectId' in data && data.projectId !== selectedProject?.id) {
        setProjectTasks(prev => prev.filter(t => t.id !== taskId))
      }

      const currentMemberActorId = members.find(
        m => m.id === currentMemberId
      )?.actorId
      if ('assigneeActorId' in data && currentMemberActorId) {
        const nowMine = data.assigneeActorId === currentMemberActorId
        const wasMine = myTasks.some(t => t.id === taskId)
        if (wasMine && !nowMine)
          setMyTasks(prev => prev.filter(t => t.id !== taskId))
        // (!wasMine && nowMine): can't synthesize a full MyTask from a partial
        // patch — fall through and let the post-fetch reconciliation handle
        // adding the task once the server returns the full record.
      }

      try {
        const { task: updated } = await tasksClient.update<{ task: ApiTask }>(
          taskId,
          data
        )
        // Patch list caches with the server's response.
        patchListItem(taskId, updated as unknown as Record<string, unknown>)
        queryClient.setQueryData<TaskDetail>(
          queryKeys.tasks.detail(taskId),
          prev => (prev ? ({ ...prev, ...updated } as TaskDetail) : prev)
        )
        if (currentMemberActorId) {
          const nowMine = updated.assigneeActorId === currentMemberActorId
          const wasMine = myTasks.some(t => t.id === taskId)
          if (wasMine && !nowMine)
            setMyTasks(prev => prev.filter(t => t.id !== taskId))
          if (!wasMine && nowMine)
            setMyTasks(prev => [...prev, updated as MyTask])
        }
      } catch (err) {
        throw err
      }
    },
    [
      patchListItem,
      queryClient,
      selectedProject?.id,
      currentMemberId,
      members,
      myTasks,
      setProjectTasks,
      setMyTasks,
    ]
  )

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      setMyTasks(prev => prev.filter(t => t.id !== taskId))
      setProjectTasks(prev => prev.filter(t => t.id !== taskId))
      queryClient.removeQueries({
        queryKey: queryKeys.tasks.detail(taskId),
        exact: true,
      })

      try {
        await tasksClient.delete(taskId)
      } catch {
        // silently ignore — optimistic removal already applied
      }
    },
    [queryClient, setMyTasks, setProjectTasks]
  )

  const handleCreateTask = useCallback(
    async ({
      title,
      description,
      status,
      priority,
      projectId,
      assigneeId,
      sprintId,
      aiSuggestedPriority,
    }: NewTaskFormData) => {
      const tempId = `optimistic-task-${Date.now()}`
      const now = new Date().toISOString()
      const project = projects.find(p => p.id === projectId)
      const optimistic: ApiTask = {
        id: tempId,
        title,
        status,
        priority,
        projectId,
        assigneeActorId: assigneeId ?? null,
        createdAt: now,
        updatedAt: now,
        viewOrder: null,
        number: 0,
        teamIdentifier: '',
        ...(project ? { project: { id: projectId, name: project.name } } : {}),
      }

      if (projectId === selectedProject?.id) {
        setProjectTasks(prev => [...prev, optimistic])
      }
      if (assigneeId && assigneeId === currentMemberId) {
        setMyTasks(prev => [...prev, optimistic as MyTask])
      }
      queryClient.setQueryData<TaskDetail>(
        queryKeys.tasks.detail(tempId),
        optimistic as unknown as TaskDetail
      )

      let task: ApiTask
      try {
        const data = await projectsClient.createTask<{ task: ApiTask }>(
          projectId,
          {
            title,
            description: description.trim() || undefined,
            status,
            priority,
            assigneeActorId: assigneeId || undefined,
            sprintId: sprintId ?? undefined,
          }
        )
        task = data.task
      } catch (err) {
        setProjectTasks(prev => prev.filter(t => t.id !== tempId))
        setMyTasks(prev => prev.filter(t => t.id !== tempId))
        queryClient.removeQueries({
          queryKey: queryKeys.tasks.detail(tempId),
          exact: true,
        })
        const message =
          err instanceof Error ? err.message : 'Failed to create task'
        toast.error(message ?? intl.formatMessage({ id: 'task.createFailed' }))
        throw err
      }

      const settled: ApiTask = {
        ...task,
        ...(project ? { project: { id: projectId, name: project.name } } : {}),
      }
      setProjectTasks(prev => prev.map(t => (t.id === tempId ? settled : t)))
      setMyTasks(prev =>
        prev.map(t => (t.id === tempId ? (settled as MyTask) : t))
      )
      queryClient.removeQueries({
        queryKey: queryKeys.tasks.detail(tempId),
        exact: true,
      })
      queryClient.setQueryData<TaskDetail>(
        queryKeys.tasks.detail(settled.id),
        settled as unknown as TaskDetail
      )

      setProjects(prev =>
        prev.map(p =>
          p.id === projectId
            ? { ...p, _count: { tasks: p._count.tasks + 1 } }
            : p
        )
      )
      toast.success(intl.formatMessage({ id: 'task.createSuccess' }), {
        description: `${task.teamIdentifier}-${task.number} - ${task.title}`,
      })

      if (aiSuggestedPriority && aiSuggestedPriority !== priority) {
        apiFetchQuiet('/api/tasks/priority-override', {
          method: 'POST',
          body: {
            taskId: task.id,
            projectId,
            aiSuggested: aiSuggestedPriority,
            userChosen: priority,
            taskTitle: title,
            taskDescription: description || undefined,
          },
        })
      }
    },
    [
      selectedProject?.id,
      queryClient,
      setProjectTasks,
      setMyTasks,
      setProjects,
      projects,
      currentMemberId,
      intl,
    ]
  )

  // ─── DnD setTasks wrappers ──────────────────────────────────────────────
  // Both list caches already trigger per-task mirroring on every setTasks
  // call, so DnD just routes through the same setters.
  const setMyTasksForDnD = setMyTasks
  const setProjectTasksForDnD = setProjectTasks

  // ─── Status change tracking for per-status counts ──────────────────────
  const handleProjectTaskStatusChanged = useCallback(
    (_taskId: string, oldStatus: string, newStatus: string) => {
      if (!selectedProject) return
      const KEY: Record<
        string,
        'todoCount' | 'inProgressCount' | 'inReviewCount' | 'doneCount'
      > = {
        TODO: 'todoCount',
        IN_PROGRESS: 'inProgressCount',
        IN_REVIEW: 'inReviewCount',
        DONE: 'doneCount',
      }
      const oldKey = KEY[oldStatus]
      const newKey = KEY[newStatus]
      if (!oldKey || !newKey || oldKey === newKey) return

      setProjects(prev =>
        prev.map(p =>
          p.id === selectedProject.id
            ? {
                ...p,
                [oldKey]: Math.max(0, p[oldKey] - 1),
                [newKey]: p[newKey] + 1,
              }
            : p
        )
      )
    },
    [selectedProject, setProjects]
  )

  // ─── Modal openers ─────────────────────────────────────────────────────
  const openNewTaskModal = useCallback(
    (assigneeId?: string, status?: ApiStatus) => {
      fetchProjects()
      return { assigneeId, status } // caller manages modal state
    },
    [fetchProjects]
  )

  // ─── Delete project helper (cleans up task lists + per-task cache) ──────
  const handleDeleteProjectTasks = useCallback(
    (projectId: string) => {
      const deletedIds = projectTasks
        .filter(t => t.projectId === projectId)
        .map(t => t.id)
      deletedIds.forEach(id => {
        descriptionCache.current.delete(id)
        queryClient.removeQueries({
          queryKey: queryKeys.tasks.detail(id),
          exact: true,
        })
      })
      setProjectTasks([])
      setMyTasks(prev => prev.filter(t => t.projectId !== projectId))
    },
    [projectTasks, queryClient, setProjectTasks, setMyTasks]
  )

  return {
    descriptionCache,
    handleOpenTask,
    handleUpdateTask,
    handleDeleteTask,
    handleCreateTask,
    setMyTasksForDnD,
    setProjectTasksForDnD,
    handleProjectTaskStatusChanged,
    openNewTaskModal,
    handleDeleteProjectTasks,
  }
}
