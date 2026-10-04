import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { decrypt } from '@/lib/crypto'
import { slackService } from '@/lib/services/slack.service'
import { memberAuditContext } from '@/lib/api/audit-context'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const status = await slackService.getIntegrationStatus(ws.workspaceId)

    return NextResponse.json(status)
  } catch (error) {
    console.error('GET /api/slack/integration error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const memberResult = await requireWorkspaceMember(ws.workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    const { integrationToken, performDelete } =
      await slackService.deleteIntegration(
        ws.workspaceId,
        memberResult.role,
        memberAuditContext(request.headers, {
          clerkId: userId,
          memberId: memberResult.id,
        })
      )

    // Revoke token with Slack (fire-and-forget)
    const token = decrypt(integrationToken)
    fetch('https://slack.com/api/auth.revoke', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }).catch(err => console.error('[slack] token revoke failed:', err))

    await performDelete()
    return NextResponse.json({ success: true })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status === 403) {
      return NextResponse.json(
        { error: 'Only workspace owners can disconnect Slack' },
        { status: 403 }
      )
    }
    if (status === 404) {
      return NextResponse.json({ error: 'Not connected' }, { status: 404 })
    }
    console.error('DELETE /api/slack/integration error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
