import type { MemoryCategory } from '@prisma/client'
import { taskRepository } from '@/lib/repositories/task.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'

export interface Layer2Input {
  task: {
    id: string
    title: string
    description: string | null
    projectId: string
    workspaceId: string
  }
  /** Active task-scoped memories accumulated over the task's lifetime. */
  taskMemories: Array<{
    id: string
    category: MemoryCategory
    content: unknown
  }>
}

/**
 * Gather everything Layer 2 needs to distill task-scoped memory into project
 * facts. Returns null when the task is gone or has no active task memory —
 * caller treats that as "skip distillation, just archive (nothing to archive)
 * and return".
 */
export async function getLayer2Input(
  taskId: string
): Promise<Layer2Input | null> {
  const task = await taskRepository.findForMemoryContext(taskId)
  if (!task) return null

  const taskMemories = await memoryRepository.findActiveTaskMemories(taskId)
  if (taskMemories.length === 0) return null

  return {
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      projectId: task.projectId,
      workspaceId: task.project.workspaceId,
    },
    taskMemories: taskMemories.map(m => ({
      id: m.id,
      category: m.category,
      content: m.content,
    })),
  }
}
