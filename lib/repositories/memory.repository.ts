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
   * Active task-scoped memories for a given task. "Active" = `archivedAt IS
   * NULL`. Used by Layer 1 extraction to feed the LLM the running context so
   * it can issue UPDATE / DELETE ops against existing rows instead of always
   * appending.
   */
  async findActiveTaskMemories(taskId: string) {
    return prisma.memory.findMany({
      where: { taskId, archivedAt: null },
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
   * Soft-delete by setting `archivedAt`. We never hard-delete: keeping the
   * row preserves audit history and makes it possible to inspect what
   * Layer 1 retracted and when.
   */
  async archive(
    id: string,
    tx?: Prisma.TransactionClient,
    now: Date = new Date()
  ) {
    const client = tx ?? prisma
    return client.memory.update({
      where: { id },
      data: { archivedAt: now },
      select: { id: true },
    })
  },
}
