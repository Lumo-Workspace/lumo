import { prisma } from '@/lib/db/prisma'

interface CreateCommentData {
  taskId: string
  authorActorId: string
  body: string
  parentId: string | null
  quotedCommentId: string | null
}

export const commentRepository = {
  async findByTaskId(taskId: string) {
    return prisma.comment.findMany({
      where: { taskId, parentId: null, deletedAt: null },
      include: {
        replies: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' as const },
        },
      },
      orderBy: { createdAt: 'asc' as const },
    })
  },

  async findById(id: string) {
    return prisma.comment.findUnique({ where: { id } })
  },

  /**
   * All non-deleted comments for a task (top-level + replies), flattened in
   * chronological order. Used by the context-tiering pipeline to count the
   * thread and build the LLM summary input, and by the context renderer
   * (LUM-122) which also needs `createdAt` for the inline card timestamps.
   */
  async listAllForTask(taskId: string) {
    return prisma.comment.findMany({
      where: { taskId, deletedAt: null },
      select: { id: true, authorActorId: true, body: true, createdAt: true },
      orderBy: { createdAt: 'asc' as const },
    })
  },

  async create(data: CreateCommentData) {
    return prisma.comment.create({ data })
  },

  async findByIdWithTask(id: string) {
    return prisma.comment.findUnique({
      where: { id },
      include: {
        task: { select: { project: { select: { workspaceId: true } } } },
      },
    })
  },

  async update(id: string, data: { body: string }) {
    return prisma.comment.update({ where: { id }, data })
  },

  /** Soft-delete: sets deletedAt to now. */
  async delete(id: string) {
    return prisma.comment.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
  },
}
