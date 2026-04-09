import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { notificationService } from '@/lib/services/notification.service'

type Params = { params: Promise<{ id: string }> }

/**
 * Resolve the current user's Actor ID from their Clerk userId.
 * Returns null if the user has no workspace or no actor.
 */
async function resolveCurrentActorId(userId: string): Promise<string | null> {
  const ws = await getUserWorkspace(userId)
  if (!ws) return null
  return getHumanActorId(ws.member.id)
}

/**
 * PATCH /api/notifications/[id] — mark a single notification as read or unread.
 * Body: { read?: boolean } — defaults to true
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const currentActorId = await resolveCurrentActorId(userId)
    if (!currentActorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const read = typeof body.read === 'boolean' ? body.read : true

    await notificationService.updateRead(id, currentActorId, read)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 404 || status === 403) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    console.error('PATCH /api/notifications/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/notifications/[id] — delete a single notification.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const currentActorId = await resolveCurrentActorId(userId)
    if (!currentActorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await notificationService.deleteNotification(id, currentActorId)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 404 || status === 403) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    console.error('DELETE /api/notifications/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
