import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getResend } from '@/lib/email/resend'
import { buildInviteEmail } from '@/lib/email/templates/invite'

const INVITE_EXPIRY_DAYS = 7

export async function POST(
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
      select: {
        id: true,
        workspaceId: true,
        status: true,
        email: true,
        inviterName: true,
        workspace: { select: { name: true, slug: true } },
      },
    })

    if (!invite || invite.workspaceId !== ws.workspaceId) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    if (invite.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'Only PENDING invites can be resent' },
        { status: 400 }
      )
    }

    // Reset expiry
    const expiresAt = new Date(
      Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    )
    await prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: { expiresAt },
    })

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const inviteUrl = `${appUrl}/invite/${token}`
    const inviterFullName = invite.inviterName
    const inviterFirstName = inviterFullName.split(' ')[0] || inviterFullName
    const { subject, html } = buildInviteEmail({
      workspaceName: invite.workspace.name,
      inviterName: inviterFullName,
      inviterFirstName,
      inviterEmail: ws.workspace.slug + '@uselumo.ai',
      inviteUrl,
    })

    const resend = getResend()
    await resend.emails.send(
      {
        from: 'Lumo <noreply@uselumo.ai>',
        to: [invite.email],
        subject,
        html,
      },
      { idempotencyKey: `workspace-invite-resend/${invite.id}-${Date.now()}` }
    )

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('POST /api/invites/[token]/resend error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
