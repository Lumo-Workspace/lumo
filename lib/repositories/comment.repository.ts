import { prisma } from '@/lib/db/prisma'

interface CreateCommentData {
  taskId: string
  authorActorId: string
  body: string
  parentId: string | null
  quotedCommentId: string | null
}

export const commentRepository = {
  /** Find top-level comments for a task with nested replies. */
  async findByTaskId(taskId: string) {
    return prisma.comment.findMany({
      where: { taskId, parentId: null },
      include: { replies: { orderBy: { createdAt: 'asc' as const } } },
      orderBy: { createdAt: 'asc' as const },
    })
  },

  /** Find a single comment by ID. */
  async findById(id: string) {
    return prisma.comment.findUnique({ where: { id } })
  },

  /** Create a new comment. */
  async create(data: CreateCommentData) {
    return prisma.comment.create({ data })
  },
}
