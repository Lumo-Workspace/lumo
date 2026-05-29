import { memoryRepository } from '@/lib/repositories/memory.repository'
import type { MemoryCategory } from '@prisma/client'
import type { MemoryContent } from '@/lib/memory/schemas'
import type { Prisma } from '@prisma/client'

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

interface CreateForProjectInput {
  projectId: string
  workspaceId: string
  category: MemoryCategory
  content: MemoryContent
  actorMemberId: string
}

interface CreateForTaskInput {
  taskId: string
  projectId: string
  workspaceId: string
  category: MemoryCategory
  content: MemoryContent
  actorMemberId: string
}

/**
 * Human-driven CRUD over Memory rows. Deliberately disjoint from
 * lib/services/memory/ (layer1/layer2), which are LLM-driven and must not
 * pull their gateway dependencies into the HTTP request path.
 */
export const memoryManagementService = {
  listProjectMemories(projectId: string) {
    return memoryRepository.listForProject(projectId)
  },

  listTaskMemories(taskId: string) {
    return memoryRepository.listForTask(taskId)
  },

  createForProject(input: CreateForProjectInput) {
    return memoryRepository.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: null,
      scope: 'PROJECT',
      category: input.category,
      content: input.content as Prisma.InputJsonValue,
      sourceSessionId: null,
      createdByMemberId: input.actorMemberId,
    })
  },

  createForTask(input: CreateForTaskInput) {
    return memoryRepository.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      scope: 'TASK',
      category: input.category,
      content: input.content as Prisma.InputJsonValue,
      sourceSessionId: null,
      createdByMemberId: input.actorMemberId,
    })
  },

  editContent(memoryId: string, content: MemoryContent) {
    return memoryRepository.update(memoryId, {
      content: content as Prisma.InputJsonValue,
    })
  },

  async promoteToProject(memoryId: string, content?: MemoryContent) {
    const existing = await memoryRepository.findByIdWithWorkspace(memoryId)
    if (!existing) throw httpError('Not found', 404)
    if (existing.scope === 'PROJECT') {
      throw httpError('Memory is already project-scoped', 409)
    }
    return memoryRepository.update(memoryId, {
      scope: 'PROJECT',
      taskId: null,
      ...(content !== undefined
        ? { content: content as Prisma.InputJsonValue }
        : {}),
    })
  },

  async delete(memoryId: string) {
    await memoryRepository.delete(memoryId)
  },
}
