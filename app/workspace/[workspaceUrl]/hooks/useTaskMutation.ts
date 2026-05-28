'use client'

import { useCallback } from 'react'
import type {
  TaskDetail,
  ApiStatus,
  ApiPriority,
  ApiProject,
} from '../types'
import { tasksClient } from '@/lib/api-client'

// ── Types ───────────────────────────────────────────────────────────────────

export type TaskPatchData = Partial<{
  title: string
  status: ApiStatus
  assigneeActorId: string | null
  repositoryId: string | null
  description: string | null
  spec: string | null
  projectId: string
  priority: ApiPriority
  dueDate: string | null
  tagIds: string[]
  sprintId: string | null
}>

interface UseTaskMutationOptions {
  task: TaskDetail
  setTask: React.Dispatch<React.SetStateAction<TaskDetail>>
  projects: ApiProject[]
  /**
   * Optional external update callback (TaskDetailPanel receives this from parent).
   * When provided, called instead of the default tasksClient.update().
   */
  onExternalUpdate?: (taskId: string, data: TaskPatchData) => Promise<void>
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useTaskMutation({
  task,
  setTask,
  projects,
  onExternalUpdate,
}: UseTaskMutationOptions) {
  const handlePatch = useCallback(
    async (data: TaskPatchData) => {
      const snapshot = task

      // Use functional updater to avoid clobbering pending state
      // (e.g. tags set right before handlePatch in the same handler)
      const applyPatch = (prev: TaskDetail) => {
        const updated = { ...prev, ...data }
        if (data.projectId) {
          const newProject = projects.find(p => p.id === data.projectId)
          if (newProject) {
            updated.project = { id: newProject.id, name: newProject.name }
          }
        }
        return updated
      }

      // Optimistic update flows through the TanStack cache (setTask is a
      // setQueryData wrapper for tasks.detail(id)).
      setTask(applyPatch)

      try {
        if (onExternalUpdate) {
          await onExternalUpdate(task.id, data)
        } else {
          await tasksClient.update(task.id, data)
        }
      } catch {
        // Rollback on failure
        setTask(snapshot)
      }
    },
    [task, setTask, projects, onExternalUpdate]
  )

  return { handlePatch }
}
