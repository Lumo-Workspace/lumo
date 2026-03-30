import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'

/**
 * DELETE /api/workspaces/members/me
 * Removes the current user from their workspace (leave workspace).
 * Blocked if they are the last OWNER.
 */
export async function DELETE() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    // Block if this user is the last OWNER
    if (ws.member.role === 'OWNER') {
      const ownerCount = await prisma.workspaceMember.count({
        where: { workspaceId: ws.workspaceId, role: 'OWNER' },
      })
      if (ownerCount <= 1) {
        return NextResponse.json(
          {
            error:
              'Cannot leave — you are the last admin. Transfer admin to someone else first.',
          },
          { status: 400 }
        )
      }
    }

    await prisma.workspaceMember.delete({
      where: { id: ws.member.id },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/workspaces/members/me error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
