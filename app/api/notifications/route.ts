import { NextRequest, NextResponse } from 'next/server'
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

    const notifications =
      await notificationService.enrichNotifications(rawNotifications)

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
