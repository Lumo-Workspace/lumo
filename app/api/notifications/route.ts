import { NextRequest, NextResponse } from 'next/server'
import { clerkClient } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'

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

    const rawNotifications = await prisma.notification.findMany({
      where: { workspaceId: ws.workspaceId, recipientId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    if (rawNotifications.length === 0) {
      return NextResponse.json({ notifications: [], unreadCount: 0 })
    }

    // Collect IDs to batch-fetch
    const actorIds = [
      ...new Set(
        rawNotifications.map(n => n.actorId).filter(Boolean) as string[]
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

    // Batch-fetch actors from Clerk
    const clerk = await clerkClient()
    const clerkUsers =
      actorIds.length > 0
        ? await clerk.users.getUserList({
            userId: actorIds,
            limit: actorIds.length,
          })
        : { data: [] }
    const actorMap = new Map(
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

    const notifications = rawNotifications.map(n => {
      const task = n.taskId ? taskMap.get(n.taskId) : null
      return {
        id: n.id,
        type: n.type,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
        taskId: n.taskId,
        commentId: n.commentId,
        actorId: n.actorId,
        actor: n.actorId ? (actorMap.get(n.actorId) ?? null) : null,
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

    await prisma.notification.updateMany({
      where: { workspaceId: ws.workspaceId, recipientId: userId, read: false },
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
