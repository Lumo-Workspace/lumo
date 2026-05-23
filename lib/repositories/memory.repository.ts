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
   * All project-scoped memories for a project. Used by Layer 2 consolidation
   * to feed the LLM existing project facts so it can decide ADD vs UPDATE vs
   * NOOP without duplicating an already-promoted lesson.
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

  /**
   * Most recent TASK-scope memories for a project, newest first, capped at
   * `limit`. Layer 2 consolidation reads these to look for recurring lessons
   * across tasks. The `taskId` is included so the prompt can group rows by
   * source task (the "this lesson surfaced in N different tasks" signal).
   *
   * `limit` exists to bound prompt size; v1 picks a small cap (e.g. 200) and
   * accepts that very old rows will not be re-considered. If a workspace
   * outgrows this, switch to a cursor-based scan.
   */
  async findRecentTaskScopeMemoriesByProject(projectId: string, limit: number) {
    return prisma.memory.findMany({
      where: { projectId, scope: 'TASK', taskId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        category: true,
        content: true,
        taskId: true,
        createdAt: true,
      },
    })
  },

  /**
   * All task-scoped memories grouped by sourceSessionId. Used by the Agent
   * Run timeline so each Run card can show the memories that were sedimented
   * during that Claude Code session.
   */
  async findByTaskIdWithSession(taskId: string) {
    return prisma.memory.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        category: true,
        content: true,
        sourceSessionId: true,
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

  /**
   * Run a batch of memory mutation plans atomically. Each plan receives the
   * transaction client and is expected to call back into this repository
   * (create / updateContent / delete) so every primitive participates in the
   * same tx. Keeps the layer 1 apply step from having to reach into
   * `@/lib/db/prisma` directly.
   */
  async applyPlansAtomically(
    plans: Array<(tx: Prisma.TransactionClient) => Promise<void>>
  ): Promise<void> {
    await prisma.$transaction(async tx => {
      for (const plan of plans) await plan(tx)
    })
  },
}
