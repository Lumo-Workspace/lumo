import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { sendInvitesSchema } from '@/lib/validation/schemas'
import { getResend, buildInviteEmail } from '@/lib/integrations/email'
import { inviteExpiresAt } from '@/lib/utils/invite'
import { inviteService } from '@/lib/services/invite.service'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { memberAuditContext } from '@/lib/api/audit-context'

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = sendInvitesSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { emails, workspaceId } = parsed.data

    // Verify caller is a member of this workspace
    const memberResult = await requireWorkspaceMember(workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult
    const member = memberResult

    // Get inviter name from Clerk
    const clerkUser = await currentUser()
    const inviterFirstName =
      clerkUser?.firstName ??
      clerkUser?.emailAddresses[0]?.emailAddress ??
      'Someone'
    const inviterName =
      clerkUser?.firstName && clerkUser?.lastName
        ? `${clerkUser.firstName} ${clerkUser.lastName}`
        : inviterFirstName
    const inviterEmail = clerkUser?.emailAddresses[0]?.emailAddress ?? ''

    // Get workspace name and slug
    const workspace = await workspaceRepository.findNameAndSlug(workspaceId)
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      )
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const expiresAt = inviteExpiresAt()
    const resend = getResend()

    const inviteResults = await inviteService.createInvites(
      workspaceId,
      emails,
      inviterName,
      member.id,
      expiresAt,
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: member.id,
      })
    )

    const results: { email: string; status: 'sent' | 'failed' }[] = []

    for (const { email, invite } of inviteResults) {
      const inviteUrl = `${appUrl}/invite/${invite.token}`
      const { subject, html } = buildInviteEmail({
        workspaceName: workspace.name,
        inviterName,
        inviterFirstName,
        inviterEmail,
        inviteUrl,
      })

      const { error } = await resend.emails.send(
        {
          from: 'Lumo <noreply@uselumo.ai>',
          to: [email],
          subject,
          html,
        },
        { idempotencyKey: `workspace-invite/${invite.id}` }
      )

      results.push({ email, status: error ? 'failed' : 'sent' })
    }

    const sent = results.filter(r => r.status === 'sent').length
    const failed = results.filter(r => r.status === 'failed').map(r => r.email)

    return NextResponse.json({ sent, failed }, { status: 200 })
  } catch (error) {
    console.error('POST /api/invites error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    const invites = await inviteService.listPendingInvites(ws.workspaceId)

    return NextResponse.json({ invites })
  } catch (error) {
    console.error('GET /api/invites error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
