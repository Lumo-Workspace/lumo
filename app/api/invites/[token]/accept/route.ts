import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { inviteService } from '@/lib/services/invite.service'
import { memberAuditContext } from '@/lib/api/audit-context'

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
      memberAuditContext(request.headers, { clerkId: userId })
    )

    return NextResponse.json(
      { workspaceSlug: result.workspaceSlug },
      { status: 200 }
    )
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    console.error('POST /api/invites/[token]/accept error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
