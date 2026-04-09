import { NextRequest, NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { notificationService } from '@/lib/services/notification.service'

/**
 * GET /api/notifications — return unread notifications for the current user.
 * Enriched with actor info (Clerk), task info, and comment preview.
 */
export async function GET(_request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ notifications: [], unreadCount: 0 })
    }

    // Resolve current user's Actor ID to query notifications
    const recipientActorId = await getHumanActorId(ws.member.id)
    if (!recipientActorId) {
      return NextResponse.json({ notifications: [], unreadCount: 0 })
    }

    const rawNotifications = await notificationService.getNotifications(
      recipientActorId,
      ws.workspaceId
    )

    if (rawNotifications.length === 0) {
      return NextResponse.json({ notifications: [], unreadCount: 0 })
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
      await notificationService.batchFetchRelatedData(
        taskIds,
        commentIds,
        clarifyIds
      )

    const notifications = rawNotifications.map(n => {
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

    const unreadCount = notifications.filter(n => !n.read).length
    return NextResponse.json({ notifications, unreadCount })
  } catch (error) {
    console.error('GET /api/notifications error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/notifications — mark all unread notifications as read.
 */
export async function PATCH(_request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) return NextResponse.json({ ok: true })

    const recipientActorId = await getHumanActorId(ws.member.id)
    if (!recipientActorId) return NextResponse.json({ ok: true })

    await notificationService.markAllRead(recipientActorId, ws.workspaceId)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('PATCH /api/notifications error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
