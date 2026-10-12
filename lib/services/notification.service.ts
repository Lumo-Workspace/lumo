import { notificationRepository } from '@/lib/repositories/notification.repository'
import { buildProjectUrl } from '@/lib/utils/buildProjectUrl'
import { buildMilestoneUrl } from '@/lib/utils/buildMilestoneUrl'
import { buildDocumentUrl } from '@/lib/utils/buildDocumentUrl'

// ── Re-exported notification orchestration ──────────────────────────────

export {
  shouldNotify,
  shouldNotifyBatch,
  shouldNotifySlackEvent,
} from '@/lib/notifications/preferenceGate'

export {
  buildTaskNotificationCtx,
  dispatchTaskUpdateNotifications,
  notifyActor,
  notifyChannel,
  notifyStatusChange,
} from '@/lib/notifications/notifyTaskChange'
export type { TaskNotificationCtx } from '@/lib/notifications/notifyTaskChange'

export { notifyWorkspaceOwners } from '@/lib/notifications/notifyWorkspaceOwners'
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
    const sprintIds = [
      ...new Set(
        rawNotifications.map(n => n.sprintId).filter(Boolean) as string[]
      ),
    ]
    const refIdsOf = (key: 'projectId' | 'milestoneId' | 'documentId') => [
      ...new Set(rawNotifications.map(n => n[key]).filter(Boolean) as string[]),
    ]
    const projectIds = refIdsOf('projectId')
    const milestoneIds = refIdsOf('milestoneId')
    const documentIds = refIdsOf('documentId')

    // Batch-fetch Clerk profiles for HUMAN trigger actors
    const { getUserDirectory } = await import('@/lib/auth/users')
    const clerk = await getUserDirectory()
    const clerkUsers =
      humanClerkIds.length > 0
        ? await clerk.getUserList({
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

    // Batch-fetch tasks, comments, sprints, and entity references
    const {
      taskMap,
      commentMap,
      sprintMap,
      projectMap,
      milestoneMap,
      documentMap,
    } = await this.batchFetchRelatedData(
      taskIds,
      commentIds,
      sprintIds,
      projectIds,
      milestoneIds,
      documentIds
    )

    return rawNotifications.map(n => {
      const task = n.taskId ? taskMap.get(n.taskId) : null
      const sprint = n.sprintId ? sprintMap.get(n.sprintId) : null
      const project = n.projectId ? projectMap.get(n.projectId) : null
      const milestone = n.milestoneId ? milestoneMap.get(n.milestoneId) : null
      const doc = n.documentId ? documentMap.get(n.documentId) : null
      // Resolve actor display info from the trigger relation
      let actor: { name: string; imageUrl: string | null } | null = null
      if (n.trigger) {
        if (n.trigger.type === 'HUMAN' && n.trigger.member?.clerkId) {
          actor = clerkUserMap.get(n.trigger.member.clerkId) ?? null
        } else if (n.trigger.type === 'AGENT' && n.trigger.agent) {
          actor = { name: n.trigger.agent.name, imageUrl: null }
        }
      }
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
        sprintId: n.sprintId,
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
        sprint: sprint
          ? {
              id: sprint.id,
              name: sprint.name,
              number: sprint.number,
              teamId: sprint.teamId,
            }
          : null,
        projectId: n.projectId ?? null,
        milestoneId: n.milestoneId ?? null,
        documentId: n.documentId ?? null,
        project: project
          ? {
              id: project.id,
              name: project.name,
              url: buildProjectUrl(project.workspace.slug, project.name),
            }
          : null,
        milestone: milestone
          ? {
              id: milestone.id,
              name: milestone.name,
              url: buildMilestoneUrl(
                milestone.project.workspace.slug,
                milestone.project.name,
                milestone.slug
              ),
            }
          : null,
        document: doc
          ? {
              id: doc.id,
              title: doc.title,
              url: buildDocumentUrl(doc.workspace.slug, doc.slug),
            }
          : null,
        commentPreview: n.commentId
          ? (commentMap
              .get(n.commentId)
              ?.replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim() ?? null)
          : null,
        clarifyQuestion: null,
        clarifyContext: null,
      }
    })
  },

  /**
   * Batch-fetch related data for notification enrichment.
   * Returns maps for tasks, comments, and sprints keyed by ID.
   */
  async batchFetchRelatedData(
    taskIds: string[],
    commentIds: string[],
    sprintIds: string[] = [],
    projectIds: string[] = [],
    milestoneIds: string[] = [],
    documentIds: string[] = []
  ) {
    const [tasks, comments, sprints, projects, milestones, documents] =
      await Promise.all([
        taskIds.length > 0
          ? notificationRepository.batchFetchTasksByIds(taskIds)
          : [],
        commentIds.length > 0
          ? notificationRepository.batchFetchCommentsByIds(commentIds)
          : [],
        sprintIds.length > 0
          ? notificationRepository.batchFetchSprintsByIds(sprintIds)
          : [],
        projectIds.length > 0
          ? notificationRepository.batchFetchProjectsByIds(projectIds)
          : [],
        milestoneIds.length > 0
          ? notificationRepository.batchFetchMilestonesByIds(milestoneIds)
          : [],
        documentIds.length > 0
          ? notificationRepository.batchFetchDocumentsByIds(documentIds)
          : [],
      ])

    return {
      taskMap: new Map(tasks.map(t => [t.id, t])),
      commentMap: new Map(comments.map(c => [c.id, c.body])),
      sprintMap: new Map(sprints.map(s => [s.id, s])),
      projectMap: new Map(projects.map(p => [p.id, p])),
      milestoneMap: new Map(milestones.map(m => [m.id, m])),
      documentMap: new Map(documents.map(d => [d.id, d])),
    }
  },
}
