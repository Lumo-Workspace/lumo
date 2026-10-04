import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { getResend, buildInviteEmail } from '@/lib/integrations/email'
import { inviteExpiresAt } from '@/lib/utils/invite'
import { inviteService } from '@/lib/services/invite.service'
import { inviteRepository } from '@/lib/repositories/invite.repository'
import { memberAuditContext } from '@/lib/api/audit-context'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    const { token } = await params

    const invite = await inviteService.resendInvite(
      token,
      ws.workspaceId,
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: ws.member.id,
      })
    )

    // Reset expiry
    const expiresAt = inviteExpiresAt()
    await inviteRepository.resetExpiry(invite.id, expiresAt)

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
    const status = (error as { status?: number }).status
    if (status) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    console.error('POST /api/invites/[token]/resend error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
