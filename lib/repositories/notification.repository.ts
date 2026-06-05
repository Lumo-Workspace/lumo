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
  /** Find notifications for a recipient in a workspace, sorted by createdAt desc. */
  async findByRecipient(actorId: string, workspaceId: string) {
    return prisma.notification.findMany({
      where: { workspaceId, recipientActorId: actorId },
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
      triggerActorId: string | null
      commentId?: string
      documentId?: string | null
      documentCommentId?: string | null
    }[]
  ) {
    return prisma.notification.createMany({ data })
  },

  // ── AgentClarify operations ───────────────────────────────────────────────

  /** Find a pending (unreplied) clarify for a task. */
  async findPendingClarify(taskId: string) {
    return prisma.agentClarify.findFirst({
      where: { taskId, reply: null },
      orderBy: { createdAt: 'desc' },
    })
  },

  /** Find a clarify by ID with reply fields (used for polling). */
  async findClarifyForPoll(id: string) {
    return prisma.agentClarify.findUnique({
      where: { id },
      select: { taskId: true, reply: true, repliedAt: true },
    })
  },

  /** Create a new agent clarify record. */
  async createClarify(data: {
    taskId: string
    question: string
    context?: string | null
  }) {
    return prisma.agentClarify.create({ data })
  },

  /** Record a reply to a clarify. */
  async replyClarify(id: string, reply: string) {
    return prisma.agentClarify.update({
      where: { id },
      data: { reply, repliedAt: new Date() },
    })
  },

  /** Batch-fetch clarify records by IDs (for notification enrichment). */
  async batchFetchClarifyByIds(ids: string[]) {
    return prisma.agentClarify.findMany({
      where: { id: { in: ids } },
      select: { id: true, question: true, context: true },
    })
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
}
