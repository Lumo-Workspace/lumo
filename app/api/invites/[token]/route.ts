import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const invite = await prisma.workspaceInvite.findUnique({
      where: { token },
      select: {
        status: true,
        expiresAt: true,
        email: true,
        inviterName: true,
        workspace: { select: { name: true, slug: true } },
      },
    })

    if (!invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    const isExpired = invite.expiresAt < new Date()

    return NextResponse.json({
      invite: {
        workspaceName: invite.workspace.name,
        workspaceSlug: invite.workspace.slug,
        inviterName: invite.inviterName,
        email: invite.email,
        status:
          isExpired && invite.status === 'PENDING' ? 'EXPIRED' : invite.status,
      },
    })
  } catch (error) {
    console.error('GET /api/invites/[token] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const { token } = await params

    const invite = await prisma.workspaceInvite.findUnique({
      where: { token },
      select: { id: true, workspaceId: true, status: true },
    })

    if (!invite || invite.workspaceId !== ws.workspaceId) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    if (invite.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Only PENDING invites can be revoked' },
        { status: 400 }
      )
    }

    await prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { status: 'REVOKED' },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/invites/[token] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
