'use client'

import { useCallback, useRef, Dispatch, SetStateAction } from 'react'
import type {
  ApiTask,
  ApiProject,
  ApiStatus,
  ApiPriority,
  MyTask,
} from '../types'
import { apiFetchQuiet, tasksClient, projectsClient } from '@/lib/api-client'
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
  // Task store
  taskMap: Record<string, ApiTask>
  upsertTasks: (tasks: ApiTask[]) => void
  updateTask: (id: string, patch: Record<string, unknown>) => void
  removeTask: (id: string) => void
  removeTasks: (ids: string[]) => void
  replaceTempId: (tempId: string, task: ApiTask) => void

  // ID lists
  myTaskIds: string[]
  setMyTaskIds: Dispatch<SetStateAction<string[]>>
  projectTaskIds: string[]
  setProjectTaskIds: Dispatch<SetStateAction<string[]>>

  // Members
  members: Member[]
  currentMemberId: string | undefined
  fetchMembers: () => void

  // Projects
  projects: ApiProject[]
  setProjects: Dispatch<SetStateAction<ApiProject[]>>
  selectedProject: ApiProject | null
  fetchProjects: () => void
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useWorkspaceTaskHandlers({
  taskMap,
  upsertTasks,
  updateTask,
  removeTask,
  removeTasks,
  replaceTempId,
  myTaskIds,
  setMyTaskIds,
  projectTaskIds,
  setProjectTaskIds,
  members,
  currentMemberId,
  fetchMembers,
  projects,
  setProjects,
  selectedProject,
  fetchProjects,
}: UseWorkspaceTaskHandlersOptions) {
  const intl = useIntl()

  // description cache: taskId → description html (populated after first fetch)
  const descriptionCache = useRef<Map<string, string | null>>(new Map())

  // ─── Selected task (drawer) ─────────────────────────────────────────────
  // Note: selectedTask state is kept in WorkspaceApp since it's also used by modals

  const handleOpenTask = useCallback(
    (task: ApiTask | MyTask) => {
      fetchMembers()
      return task // caller sets selectedTask
    },
    [fetchMembers]
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
      updateTask(taskId, data)

      if ('projectId' in data && data.projectId !== selectedProject?.id) {
        setProjectTaskIds(prev => prev.filter(id => id !== taskId))
      }

      const currentMemberActorId = members.find(
        m => m.id === currentMemberId
      )?.actorId
      if ('assigneeActorId' in data && currentMemberActorId) {
        const nowMine = data.assigneeActorId === currentMemberActorId
        const wasMine = myTaskIds.includes(taskId)
        if (wasMine && !nowMine)
          setMyTaskIds(prev => prev.filter(id => id !== taskId))
        if (!wasMine && nowMine) setMyTaskIds(prev => [...prev, taskId])
      }

      try {
        const { task: updated } = await tasksClient.update<{ task: ApiTask }>(
          taskId,
          data
        )
        upsertTasks([updated])
        if (currentMemberActorId) {
          const nowMine = updated.assigneeActorId === currentMemberActorId
          const wasMine = myTaskIds.includes(taskId)
          if (wasMine && !nowMine)
            setMyTaskIds(prev => prev.filter(id => id !== taskId))
          if (!wasMine && nowMine) setMyTaskIds(prev => [...prev, taskId])
        }
      } catch (err) {
        throw err
      }
    },
    [
      updateTask,
      upsertTasks,
      selectedProject?.id,
      currentMemberId,
      members,
      myTaskIds,
      setProjectTaskIds,
      setMyTaskIds,
    ]
  )

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      removeTask(taskId)
      setMyTaskIds(prev => prev.filter(id => id !== taskId))
      setProjectTaskIds(prev => prev.filter(id => id !== taskId))

      try {
        await tasksClient.delete(taskId)
      } catch {
        // silently ignore — optimistic removal already applied
      }
    },
    [removeTask, setMyTaskIds, setProjectTaskIds]
  )

  const handleCreateTask = useCallback(
    async ({
      title,
      description,
      status,
      priority,
      projectId,
      assigneeId,
      repositoryId,
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
        parentTaskId: null,
        assigneeActorId: assigneeId ?? null,
        repositoryId: repositoryId ?? null,
        createdAt: now,
        updatedAt: now,
        viewOrder: null,
        number: 0,
        teamIdentifier: '',
        ...(project ? { project: { id: projectId, name: project.name } } : {}),
      }

      upsertTasks([optimistic])

      if (projectId === selectedProject?.id) {
        setProjectTaskIds(prev => [...prev, tempId])
      }

      if (assigneeId && assigneeId === currentMemberId) {
        setMyTaskIds(prev => [...prev, tempId])
      }

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
            repositoryId: repositoryId ?? undefined,
            sprintId: sprintId ?? undefined,
          }
        )
        task = data.task
      } catch (err) {
        removeTask(tempId)
        setProjectTaskIds(prev => prev.filter(id => id !== tempId))
        setMyTaskIds(prev => prev.filter(id => id !== tempId))
        const message =
          err instanceof Error ? err.message : 'Failed to create task'
        toast.error(message ?? intl.formatMessage({ id: 'task.createFailed' }))
        throw err
      }
      replaceTempId(tempId, {
        ...task,
        ...(project ? { project: { id: projectId, name: project.name } } : {}),
      })
      setProjectTaskIds(prev => prev.map(id => (id === tempId ? task.id : id)))
      setMyTaskIds(prev => prev.map(id => (id === tempId ? task.id : id)))
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
      upsertTasks,
      replaceTempId,
      removeTask,
      setProjectTaskIds,
      setMyTaskIds,
      setProjects,
      projects,
      currentMemberId,
      intl,
    ]
  )

  // ─── DnD setTasks wrappers ──────────────────────────────────────────────
  const setMyTasksForDnD = useCallback<Dispatch<SetStateAction<MyTask[]>>>(
    action => {
      const prev = myTaskIds.map(id => taskMap[id]).filter(Boolean) as MyTask[]
      const next = typeof action === 'function' ? action(prev) : action
      const changed = next.filter(t => taskMap[t.id] !== t)
      if (changed.length > 0) upsertTasks(changed)
      setMyTaskIds(next.map(t => t.id))
    },
    [myTaskIds, taskMap, upsertTasks, setMyTaskIds]
  )

  const setProjectTasksForDnD = useCallback<
    Dispatch<SetStateAction<ApiTask[]>>
  >(
    action => {
      const prev = projectTaskIds
        .map(id => taskMap[id])
        .filter(Boolean) as ApiTask[]
      const next = typeof action === 'function' ? action(prev) : action
      const changed = next.filter(t => taskMap[t.id] !== t)
      if (changed.length > 0) upsertTasks(changed)
      setProjectTaskIds(next.map(t => t.id))
    },
    [projectTaskIds, taskMap, upsertTasks, setProjectTaskIds]
  )

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
      fetchMembers()
      fetchProjects()
      return { assigneeId, status } // caller manages modal state
    },
    [fetchMembers, fetchProjects]
  )

  // ─── Delete project helper (needs descriptionCache + task cleanup) ──────
  const handleDeleteProjectTasks = useCallback(
    (projectId: string) => {
      const deletedIds = projectTaskIds.filter(
        id => taskMap[id]?.projectId === projectId
      )
      deletedIds.forEach(id => descriptionCache.current.delete(id))
      removeTasks(deletedIds)
      setProjectTaskIds([])
      setMyTaskIds(prev =>
        prev.filter(id => taskMap[id]?.projectId !== projectId)
      )
    },
    [projectTaskIds, taskMap, removeTasks, setProjectTaskIds, setMyTaskIds]
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
