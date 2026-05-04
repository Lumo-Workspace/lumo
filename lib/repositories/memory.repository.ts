import { prisma } from '@/lib/db/prisma'
import type { MemoryCategory, MemoryScope, Prisma } from '@prisma/client'

interface CreateMemoryInput {
  workspaceId: string
  projectId: string
  taskId: string | null
  scope: MemoryScope
  category: MemoryCategory
  content: Prisma.InputJsonValue
  sourceSessionId: string | null
}

export const memoryRepository = {
  /**
   * All task-scoped memories for a given task. Used by Layer 1 extraction to
   * feed the LLM the running context so it can issue UPDATE / DELETE ops
   * against existing rows instead of always appending.
   */
  async findActiveTaskMemories(taskId: string) {
    return prisma.memory.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        category: true,
        content: true,
        createdAt: true,
      },
    })
  },

  /**
   * All project-scoped memories for a project. Used by Layer 3 to feed the
   * merge LLM the existing project facts so it can decide ADD vs UPDATE vs
   * NOOP without dual-writing or stale-overwriting.
   */
  async findActiveProjectMemories(projectId: string) {
    return prisma.memory.findMany({
      where: { projectId, scope: 'PROJECT' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        category: true,
        content: true,
        createdAt: true,
      },
    })
  },

  async create(input: CreateMemoryInput, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.memory.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        taskId: input.taskId,
        scope: input.scope,
        category: input.category,
        content: input.content,
        sourceSessionId: input.sourceSessionId,
      },
      select: { id: true },
    })
  },

  async updateContent(
    id: string,
    content: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.memory.update({
      where: { id },
      data: { content },
      select: { id: true },
    })
  },

  /**
   * Hard-delete a memory row. Used by Layer 1 DELETE when the LLM retracts an
   * earlier memory because it was contradicted or superseded.
   */
  async delete(id: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.memory.delete({
      where: { id },
      select: { id: true },
    })
  },
}
