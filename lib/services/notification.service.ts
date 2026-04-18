import { notificationRepository } from '@/lib/repositories/notification.repository'

// ── Re-exported notification orchestration ──────────────────────────────

export {
  shouldNotify,
  shouldNotifyBatch,
} from '@/lib/notifications/preferenceGate'

export {
  buildTaskNotificationCtx,
  dispatchTaskUpdateNotifications,
  notifyActor,
  notifyChannel,
  notifyStatusChange,
} from '@/lib/notifications/notifyTaskChange'
export type { TaskNotificationCtx } from '@/lib/notifications/notifyTaskChange'

export {
  notifyAgentClarify,
  notifyAgentVerify,
  notifyAgentFailed,
  notifyAgentDone,
} from '@/lib/notifications/notifyAgentActions'

export { notifyReviewerOrOwners } from '@/lib/notifications/notifyReviewerOrOwners'
export { notifyTaskInReview } from '@/lib/notifications/notifyTaskInReview'

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

  /** Get a single notification by ID. Verifies recipient ownership. */
  async getNotification(notificationId: string, actorId: string) {
    const notification = await notificationRepository.findById(notificationId)
    if (!notification) {
      throw Object.assign(new Error('Notification not found'), { status: 404 })
    }
    if (notification.recipientActorId !== actorId) {
      throw Object.assign(new Error('Notification not found'), { status: 404 })
    }
    return notification
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
   * Enrich raw notifications with actor info (Clerk), task info, and comment preview.
   * Returns fully enriched notification objects ready for the API response.
   */
  async enrichNotifications(
    rawNotifications: Awaited<
      ReturnType<typeof notificationRepository.findByRecipient>
    >
  ) {
    if (rawNotifications.length === 0) {
      return []
    }

    // Collect IDs to batch-fetch
    const humanClerkIds = [
      ...new Set(
        rawNotifications
          .map(n =>
            n.trigger?.type === 'HUMAN' ? n.trigger.member?.clerkId : undefined
          )
          .filter(Boolean) as string[]
      ),
    ]
    const taskIds = [
      ...new Set(
        rawNotifications.map(n => n.taskId).filter(Boolean) as string[]
      ),
    ]
    const commentIds = [
      ...new Set(
        rawNotifications.map(n => n.commentId).filter(Boolean) as string[]
      ),
    ]
    const clarifyIds = [
      ...new Set(
        rawNotifications
          .filter(n => n.type === 'AGENT_CLARIFY' && n.clarifyId)
          .map(n => n.clarifyId) as string[]
      ),
    ]

    // Batch-fetch Clerk profiles for HUMAN trigger actors
    const { clerkClient } = await import('@clerk/nextjs/server')
    const clerk = await clerkClient()
    const clerkUsers =
      humanClerkIds.length > 0
        ? await clerk.users.getUserList({
            userId: humanClerkIds,
            limit: humanClerkIds.length,
          })
        : { data: [] }
    const clerkUserMap = new Map(
      clerkUsers.data.map(u => [
        u.id,
        {
          name:
            `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() ||
            u.emailAddresses[0]?.emailAddress ||
            'Unknown',
          imageUrl: u.imageUrl ?? null,
        },
      ])
    )

    // Batch-fetch tasks, comments, clarifies
    const { taskMap, commentMap, clarifyMap } =
      await this.batchFetchRelatedData(taskIds, commentIds, clarifyIds)

    return rawNotifications.map(n => {
      const task = n.taskId ? taskMap.get(n.taskId) : null
      // Resolve actor display info from the trigger relation
      let actor: { name: string; imageUrl: string | null } | null = null
      if (n.trigger) {
        if (n.trigger.type === 'HUMAN' && n.trigger.member?.clerkId) {
          actor = clerkUserMap.get(n.trigger.member.clerkId) ?? null
        } else if (n.trigger.type === 'AGENT' && n.trigger.agent) {
          actor = { name: n.trigger.agent.name, imageUrl: null }
        }
      }
      const clarify =
        n.type === 'AGENT_CLARIFY' && n.clarifyId
          ? (clarifyMap.get(n.clarifyId) ?? null)
          : null
      return {
        id: n.id,
        type: n.type,
        read: n.read,
        requiresAction: n.requiresAction,
        actionTakenAt: n.actionTakenAt ? n.actionTakenAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
        taskId: n.taskId,
        commentId: n.commentId,
        clarifyId: n.clarifyId,
        triggerActorId: n.triggerActorId,
        actor,
        task: task
          ? {
              id: task.id,
              title: task.title,
              number: task.number,
              teamIdentifier: task.team.identifier,
            }
          : null,
        commentPreview: n.commentId
          ? (commentMap
              .get(n.commentId)
              ?.replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim() ?? null)
          : null,
        clarifyQuestion: clarify?.question ?? null,
        clarifyContext: clarify?.context ?? null,
      }
    })
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
