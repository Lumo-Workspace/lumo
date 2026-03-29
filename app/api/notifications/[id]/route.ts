import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'

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

    const notification = await prisma.notification.findUnique({ where: { id } })
    if (!notification) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const currentActorId = await resolveCurrentActorId(userId)
    if (!currentActorId || notification.recipientActorId !== currentActorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const read = typeof body.read === 'boolean' ? body.read : true

    await prisma.notification.update({ where: { id }, data: { read } })

    return NextResponse.json({ ok: true })
  } catch (error) {
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

    const notification = await prisma.notification.findUnique({ where: { id } })
    if (!notification) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const currentActorId = await resolveCurrentActorId(userId)
    if (!currentActorId || notification.recipientActorId !== currentActorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await prisma.notification.delete({ where: { id } })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/notifications/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
