import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const { token } = await params

    const invite = await prisma.workspaceInvite.findUnique({
      where: { token },
      include: {
        workspace: {
          include: {
            teams: { where: { isDefault: true }, take: 1 },
          },
        },
      },
    })

    if (!invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    if (invite.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'This invitation has already been used or revoked' },
        { status: 409 }
      )
    }

    if (invite.expiresAt < new Date()) {
      return NextResponse.json(
        { error: 'This invitation has expired' },
        { status: 410 }
      )
    }

    // Idempotent: already a member → just redirect
    const existingMember = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_clerkId: {
          workspaceId: invite.workspaceId,
          clerkId: userId,
        },
      },
    })
    if (existingMember) {
      return NextResponse.json(
        { workspaceSlug: invite.workspace.slug },
        { status: 200 }
      )
    }

    const defaultTeam = invite.workspace.teams[0]

    // Transaction: create member + add to default team + mark invite accepted
    await prisma.$transaction(async tx => {
      const member = await tx.workspaceMember.create({
        data: {
          workspaceId: invite.workspaceId,
          clerkId: userId,
          role: 'MEMBER',
        },
      })

      if (defaultTeam) {
        await tx.teamMember.create({
          data: { teamId: defaultTeam.id, memberId: member.id },
        })
      }

      await tx.workspaceInvite.update({
        where: { id: invite.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      })
    })

    return NextResponse.json(
      { workspaceSlug: invite.workspace.slug },
      { status: 200 }
    )
  } catch (error) {
    console.error('POST /api/invites/[token]/accept error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
