import { prisma } from '@/lib/db/prisma'
import type { ContentSignals } from '@/shared/src/untrusted-content'
import { contentSignalsData } from './content-signals-column'
import {
  redactStoredFields,
  STORAGE_REDACTED_FIELDS,
} from '@/lib/security-scan/storage-redaction'

interface CreateCommentData {
  taskId: string
  authorActorId: string
  body: string
  parentId: string | null
  quotedCommentId: string | null
  /** LUM-783: scan of the body; null = clean, omit = not scanned. */
  contentSignals?: ContentSignals | null
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
  /** LUM-783: scan of the body; null = clean, omit = not scanned. */
  contentSignals?: ContentSignals | null
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
        body: redactStoredFields(data, STORAGE_REDACTED_FIELDS.comment).body,
        parentId: null,
        quotedCommentId: null,
        ...contentSignalsData(data.contentSignals),
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
    const { contentSignals, ...rest } = data
    return prisma.comment.create({
      data: {
        ...redactStoredFields(rest, STORAGE_REDACTED_FIELDS.comment),
        ...contentSignalsData(contentSignals),
      },
    })
  },

  async findByIdWithTask(id: string) {
    return prisma.comment.findUnique({
      where: { id },
      include: {
        task: { select: { project: { select: { workspaceId: true } } } },
      },
    })
  },

  async update(
    id: string,
    data: { body: string; contentSignals?: ContentSignals | null }
  ) {
    return prisma.comment.update({
      where: { id },
      data: {
        ...redactStoredFields(
          { body: data.body },
          STORAGE_REDACTED_FIELDS.comment
        ),
        ...contentSignalsData(data.contentSignals),
      },
    })
  },

  /** Soft-delete: sets deletedAt to now. */
  async delete(id: string) {
    return prisma.comment.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
  },
}
