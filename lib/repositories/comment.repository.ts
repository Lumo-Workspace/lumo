import { prisma } from '@/lib/db/prisma'

interface CreateCommentData {
  taskId: string
  authorActorId: string
  body: string
  parentId: string | null
  quotedCommentId: string | null
}

/**
 * An idea comment (LUM-680). Ideas reuse the same `comments` table via the
 * polymorphic `ideaId` FK, but the thread is flat (no replies/quotes/PR-mirror),
 * so the create shape is deliberately narrower than the task variant.
 */
interface CreateIdeaCommentData {
  ideaId: string
  authorActorId: string
  body: string
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

  /**
   * An idea's comment thread — flat, oldest first (LUM-680). Idea comments have
   * no replies, so no nested include is needed; `replies: []` is added by the
   * service so the shape still matches the shared comment-thread renderer.
   */
  async findByIdeaId(ideaId: string) {
    return prisma.comment.findMany({
      where: { ideaId, deletedAt: null },
      orderBy: { createdAt: 'asc' as const },
    })
  },

  /** Create a flat comment on an idea (LUM-680). */
  async createForIdea(data: CreateIdeaCommentData) {
    return prisma.comment.create({
      data: {
        ideaId: data.ideaId,
        authorActorId: data.authorActorId,
        body: data.body,
        parentId: null,
        quotedCommentId: null,
      },
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
