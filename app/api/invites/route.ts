import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { currentUser } from '@clerk/nextjs/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { sendInvitesSchema } from '@/lib/validation/schemas'
import { getResend } from '@/lib/email/resend'
import { buildInviteEmail } from '@/lib/email/templates/invite'

const INVITE_EXPIRY_DAYS = 7

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = sendInvitesSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
        { status: 400 }
      )
    }

    const { emails, workspaceId } = parsed.data

    // Verify caller is a member of this workspace
    const memberResult = await requireWorkspaceMember(workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult
    const member = memberResult

    // Get inviter name from Clerk
    const clerkUser = await currentUser()
    const inviterName =
      clerkUser?.firstName && clerkUser?.lastName
        ? `${clerkUser.firstName} ${clerkUser.lastName}`
        : (clerkUser?.firstName ??
          clerkUser?.emailAddresses[0]?.emailAddress ??
          'Someone')
    const inviterEmail = clerkUser?.emailAddresses[0]?.emailAddress ?? ''

    // Get workspace name and slug
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, slug: true },
    })
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      )
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const expiresAt = new Date(
      Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    )
    const resend = getResend()

    const results: { email: string; status: 'sent' | 'failed' }[] = []

    for (const rawEmail of emails) {
      const email = rawEmail.toLowerCase()

      // Upsert: delete any existing pending invite for this email+workspace, then create fresh
      await prisma.workspaceInvite.deleteMany({
        where: { workspaceId, email, status: 'PENDING' },
      })

      const invite = await prisma.workspaceInvite.create({
        data: {
          workspaceId,
          email,
          inviterName,
          invitedById: member.id,
          expiresAt,
        },
      })

      const inviteUrl = `${appUrl}/invite/${invite.token}`
      const { subject, html } = buildInviteEmail({
        workspaceName: workspace.name,
        inviterName,
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
