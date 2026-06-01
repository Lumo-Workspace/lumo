import { prisma } from '@/lib/db/prisma'
import type {
  MemoryCategory,
  MemoryScope,
  Prisma,
  TaskArtifactAgent,
} from '@prisma/client'

const MEMORY_ROW_SELECT = {
  id: true,
  scope: true,
  category: true,
  agent: true,
  content: true,
  taskId: true,
  createdByMemberId: true,
  createdAt: true,
  updatedAt: true,
} as const

interface CreateMemoryInput {
  workspaceId: string
  projectId: string
  taskId: string | null
  scope: MemoryScope
  category: MemoryCategory
  content: Prisma.InputJsonValue
  sourceSessionId: string | null
  createdByMemberId: string | null
  agent?: TaskArtifactAgent | undefined
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
        agent: true,
        content: true,
        sourceSessionId: true,
        createdAt: true,
      },
    })
  },

  /** All PROJECT-scope memories for a project, newest first. Management UI. */
  async listForProject(projectId: string) {
    return prisma.memory.findMany({
      where: { projectId, scope: 'PROJECT' },
      orderBy: { createdAt: 'desc' },
      select: MEMORY_ROW_SELECT,
    })
  },

  /** All memories for a task, newest first. Management UI. */
  async listForTask(taskId: string) {
    return prisma.memory.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      select: MEMORY_ROW_SELECT,
    })
  },

  /**
   * Patch content and/or scope and/or taskId in one write. Undefined fields
   * are omitted so a content-only edit never touches scope. Returns the full
   * row for the HTTP response.
   */
  async update(
    id: string,
    patch: {
      content?: Prisma.InputJsonValue
      scope?: MemoryScope
      taskId?: string | null
    },
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    const data: Prisma.MemoryUpdateInput = {}
    if (patch.content !== undefined) data.content = patch.content
    if (patch.scope !== undefined) data.scope = patch.scope
    if (patch.taskId !== undefined) {
      data.task =
        patch.taskId === null
          ? { disconnect: true }
          : { connect: { id: patch.taskId } }
    }
    return client.memory.update({
      where: { id },
      data,
      select: MEMORY_ROW_SELECT,
    })
  },

  /** Auth-relevant fields for PATCH/DELETE routes. */
  async findByIdWithWorkspace(id: string) {
    return prisma.memory.findUnique({
      where: { id },
      select: {
        id: true,
        workspaceId: true,
        projectId: true,
        taskId: true,
        scope: true,
        category: true,
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
        createdByMemberId: input.createdByMemberId,
        ...(input.agent !== undefined ? { agent: input.agent } : {}),
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
   * Try to claim the Layer 2 consolidation lease for a project. Atomic: the
   * guarded `updateMany` only matches (and thus only one concurrent caller
   * wins the row lock) when the lease is unset or already expired. Returns
   * true if this caller acquired it, false if another run holds it.
   *
   * This is the cross-instance serialization Layer 2 relies on — `waitUntil`
   * fan-out from concurrent task completions can run in separate serverless
   * instances, so an in-process lock is insufficient; the DB row is the only
   * shared point of truth.
   */
  async tryClaimLayer2Lease(
    projectId: string,
    until: Date,
    now: Date
  ): Promise<boolean> {
    const res = await prisma.project.updateMany({
      where: {
        id: projectId,
        OR: [
          { memoryConsolidationLockedUntil: null },
          { memoryConsolidationLockedUntil: { lt: now } },
        ],
      },
      data: { memoryConsolidationLockedUntil: until },
    })
    return res.count === 1
  },

  /**
   * Release the Layer 2 lease for a project. Uses `updateMany` (not `update`)
   * so a missing/changed row is a no-op rather than a throw — release runs in
   * a `finally` and must never mask the original error.
   */
  async releaseLayer2Lease(projectId: string): Promise<void> {
    await prisma.project.updateMany({
      where: { id: projectId },
      data: { memoryConsolidationLockedUntil: null },
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
