import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

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
