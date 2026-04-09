import { notificationRepository } from '@/lib/repositories/notification.repository'

export const notificationService = {
  /**
   * Get enriched notifications for a recipient.
   * Returns raw notifications with trigger info — caller enriches with Clerk user data.
   */
  async getNotifications(actorId: string, workspaceId: string) {
    const rawNotifications = await notificationRepository.findByRecipient(
      actorId,
      workspaceId
    )

    // Sort actionable (requiresAction=true AND actionTakenAt=null) to top,
    // then by createdAt desc.
    rawNotifications.sort((a, b) => {
      const aActionable = a.requiresAction && a.actionTakenAt === null
      const bActionable = b.requiresAction && b.actionTakenAt === null
      if (aActionable && !bActionable) return -1
      if (!aActionable && bActionable) return 1
      return b.createdAt.getTime() - a.createdAt.getTime()
    })

    return rawNotifications
  },

  /** Mark a single notification as read or unread, with ownership check. */
  async updateRead(
    notificationId: string,
    currentActorId: string,
    read: boolean
  ) {
    const notification = await notificationRepository.findById(notificationId)
    if (!notification) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }
    if (notification.recipientActorId !== currentActorId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }
    await notificationRepository.updateRead(notificationId, read)
  },

  /** Mark all notifications as read for a recipient. */
  async markAllRead(actorId: string, workspaceId: string) {
    await notificationRepository.markAllRead(actorId, workspaceId)
  },

  /** Delete a notification with ownership check. */
  async deleteNotification(notificationId: string, currentActorId: string) {
    const notification = await notificationRepository.findById(notificationId)
    if (!notification) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }
    if (notification.recipientActorId !== currentActorId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }
    await notificationRepository.deleteById(notificationId)
  },

  /**
   * Load a notification for responding, with ownership and action checks.
   * Throws on not found, forbidden, not actionable, or already actioned.
   */
  async loadForRespond(notificationId: string, recipientActorId: string) {
    const notification =
      await notificationRepository.findForRespond(notificationId)
    if (!notification) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }
    if (notification.recipientActorId !== recipientActorId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }
    if (!notification.requiresAction) {
      throw Object.assign(
        new Error('This notification does not require an action'),
        { status: 409 }
      )
    }
    if (notification.actionTakenAt) {
      throw Object.assign(new Error('Action already taken'), { status: 409 })
    }
    if (!notification.taskId) {
      throw Object.assign(new Error('No task linked'), { status: 422 })
    }
    return notification
  },

  /** Mark a notification as action-taken. */
  async markActionTaken(notificationId: string) {
    await notificationRepository.markActionTaken(notificationId)
  },

  /** Record a reply to a clarify request. */
  async replyClarify(clarifyId: string, reply: string) {
    await notificationRepository.replyClarify(clarifyId, reply)
  },

  /**
   * Batch-fetch related data for notification enrichment.
   * Returns maps for tasks, comments, and clarifies keyed by ID.
   */
  async batchFetchRelatedData(
    taskIds: string[],
    commentIds: string[],
    clarifyIds: string[]
  ) {
    const [tasks, comments, clarifies] = await Promise.all([
      taskIds.length > 0
        ? notificationRepository.batchFetchTasksByIds(taskIds)
        : [],
      commentIds.length > 0
        ? notificationRepository.batchFetchCommentsByIds(commentIds)
        : [],
      clarifyIds.length > 0
        ? notificationRepository.batchFetchClarifyByIds(clarifyIds)
        : [],
    ])

    return {
      taskMap: new Map(tasks.map(t => [t.id, t])),
      commentMap: new Map(comments.map(c => [c.id, c.body])),
      clarifyMap: new Map(clarifies.map(c => [c.id, c])),
    }
  },
}
