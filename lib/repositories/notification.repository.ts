import { prisma } from '@/lib/db/prisma'
import type { NotificationType } from '@prisma/client'

/** Include clause for trigger actor details — used when fetching notifications for display. */
const TRIGGER_INCLUDE = {
  trigger: {
    select: {
      id: true,
      type: true,
      member: { select: { clerkId: true } },
      agent: { select: { name: true, avatarColor: true } },
    },
  },
} as const

/** Select clause for notification used in respond flow. */
const RESPOND_SELECT = {
  id: true,
  type: true,
  requiresAction: true,
  actionTakenAt: true,
  recipientActorId: true,
  taskId: true,
  clarifyId: true,
} as const

export const notificationRepository = {
  /**
   * Find notifications for a recipient in a workspace, sorted by createdAt
   * desc (newest 50). `unreadOnly` filters in the query, before the cap.
   */
  async findByRecipient(
    actorId: string,
    workspaceId: string,
    opts: { unreadOnly?: boolean } = {}
  ) {
    return prisma.notification.findMany({
      where: {
        workspaceId,
        recipientActorId: actorId,
        ...(opts.unreadOnly ? { read: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: TRIGGER_INCLUDE,
    })
  },

  /** Find a single notification by ID. */
  async findById(id: string) {
    return prisma.notification.findUnique({ where: { id } })
  },

  /** Find a notification by ID with fields needed for respond flow. */
  async findForRespond(id: string) {
    return prisma.notification.findUnique({
      where: { id },
      select: RESPOND_SELECT,
    })
  },

  /** Mark a single notification as read (or unread). */
  async updateRead(id: string, read: boolean) {
    return prisma.notification.update({ where: { id }, data: { read } })
  },

  /** Mark all unread notifications as read for a recipient in a workspace. */
  async markAllRead(actorId: string, workspaceId: string) {
    return prisma.notification.updateMany({
      where: { workspaceId, recipientActorId: actorId, read: false },
      data: { read: true },
    })
  },

  /** Mark a notification as action-taken (also marks as read). */
  async markActionTaken(id: string) {
    return prisma.notification.update({
      where: { id },
      data: { actionTakenAt: new Date(), read: true },
    })
  },

  /** Delete a single notification. */
  async deleteById(id: string) {
    return prisma.notification.delete({ where: { id } })
  },

  /** Create a single notification. */
  async create(data: {
    workspaceId: string
    recipientActorId: string
    type: NotificationType
    taskId?: string | null
    sprintId?: string | null
    triggerActorId: string | null
    commentId?: string
  }) {
    return prisma.notification.create({ data })
  },

  /** Create many notifications at once. */
  async createMany(
    data: {
      workspaceId: string
      recipientActorId: string
      type: NotificationType
      taskId?: string | null
      sprintId?: string | null
      projectId?: string | null
      milestoneId?: string | null
      triggerActorId: string | null
      commentId?: string
      documentId?: string | null
      documentCommentId?: string | null
    }[]
  ) {
    return prisma.notification.createMany({ data })
  },

  // ── Batch-fetch helpers for notification enrichment ────────────────────────

  /** Batch-fetch tasks by IDs with team identifier (for notification display). */
  async batchFetchTasksByIds(ids: string[]) {
    return prisma.task.findMany({
      where: { id: { in: ids } },
      include: { team: { select: { identifier: true } } },
    })
  },

  /** Batch-fetch comment previews by IDs (excludes soft-deleted comments). */
  async batchFetchCommentsByIds(ids: string[]) {
    return prisma.comment.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, body: true },
    })
  },

  /** Batch-fetch sprint info by IDs (for notification display). */
  async batchFetchSprintsByIds(ids: string[]) {
    return prisma.sprint.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, number: true, teamId: true },
    })
  },

  /** Batch-fetch project info by IDs with workspace slug (for notification display). */
  async batchFetchProjectsByIds(ids: string[]) {
    if (ids.length === 0) return []
    return prisma.project.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, workspace: { select: { slug: true } } },
    })
  },

  /** Batch-fetch milestone info by IDs with project name + workspace slug (for notification display). */
  async batchFetchMilestonesByIds(ids: string[]) {
    if (ids.length === 0) return []
    return prisma.milestone.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        slug: true,
        project: {
          select: { name: true, workspace: { select: { slug: true } } },
        },
      },
    })
  },

  /** Batch-fetch document info by IDs with workspace slug (for notification display). */
  async batchFetchDocumentsByIds(ids: string[]) {
    if (ids.length === 0) return []
    return prisma.document.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        title: true,
        slug: true,
        workspace: { select: { slug: true } },
      },
    })
  },
}
