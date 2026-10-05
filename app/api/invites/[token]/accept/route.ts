import { NextRequest, NextResponse } from 'next/server'
import { getVerifiedEmails, requireAuth } from '@/lib/auth'
import { inviteService } from '@/lib/services/invite.service'
import { memberAuditContext } from '@/lib/api/audit-context'
import { logger } from '@/lib/logger'

/**
 * POST /api/invites/[token]/accept
 *
 * Joins the signed-in user to the invite's workspace — only when one of
 * their IdP-verified emails is the invited address (403
 * INVITE_EMAIL_MISMATCH with the masked address otherwise).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const { token } = await params

    const result = await inviteService.acceptInvite(
      token,
      userId,
      await getVerifiedEmails(),
      memberAuditContext(request.headers, { clerkId: userId })
    )

    return NextResponse.json(
      { workspaceSlug: result.workspaceSlug },
      { status: 200 }
    )
  } catch (error) {
    const { status, code, maskedEmail } = error as {
      status?: number
      code?: string
      maskedEmail?: string
    }
    if (status) {
      return NextResponse.json(
        {
          error: (error as Error).message,
          ...(code ? { code } : {}),
          ...(maskedEmail ? { maskedEmail } : {}),
        },
        { status }
      )
    }
    logger.error('POST /api/invites/[token]/accept error', {
      error: (error as Error)?.message ?? String(error),
    })
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
