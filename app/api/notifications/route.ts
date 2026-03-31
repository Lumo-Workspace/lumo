import { NextRequest, NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'

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

    const rawNotifications = await prisma.notification.findMany({
      where: { workspaceId: ws.workspaceId, recipientActorId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        trigger: {
          select: {
            id: true,
            type: true,
            member: { select: { clerkId: true } },
            agent: { select: { name: true, avatarColor: true } },
          },
        },
      },
    })

    // Sort actionable (requiresAction=true AND actionTakenAt=null) to top
    rawNotifications.sort((a, b) => {
      const aActionable = a.requiresAction && a.actionTakenAt === null
      const bActionable = b.requiresAction && b.actionTakenAt === null
      if (aActionable && !bActionable) return -1
      if (!aActionable && bActionable) return 1
      return b.createdAt.getTime() - a.createdAt.getTime()
    })

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

    // Batch-fetch tasks
    const tasks =
      taskIds.length > 0
        ? await prisma.task.findMany({
            where: { id: { in: taskIds } },
            include: { team: { select: { identifier: true } } },
          })
        : []
    const taskMap = new Map(tasks.map(t => [t.id, t]))

    // Batch-fetch comment previews
    const comments =
      commentIds.length > 0
        ? await prisma.comment.findMany({
            where: { id: { in: commentIds } },
            select: { id: true, body: true },
          })
        : []
    const commentMap = new Map(comments.map(c => [c.id, c.body]))

    // Batch-fetch AgentClarify records for AGENT_CLARIFY notifications
    const clarifyIds = [
      ...new Set(
        rawNotifications
          .filter(n => n.type === 'AGENT_CLARIFY' && n.clarifyId)
          .map(n => n.clarifyId) as string[]
      ),
    ]
    const clarifies =
      clarifyIds.length > 0
        ? await prisma.agentClarify.findMany({
            where: { id: { in: clarifyIds } },
            select: { id: true, question: true, context: true },
          })
        : []
    const clarifyMap = new Map(clarifies.map(c => [c.id, c]))

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

    await prisma.notification.updateMany({
      where: { workspaceId: ws.workspaceId, recipientActorId, read: false },
      data: { read: true },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('PATCH /api/notifications error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
