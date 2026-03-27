import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import {
  requireAuth,
  getUserWorkspace,
  requireWorkspaceMember,
} from '@/lib/auth'
import { decrypt } from '@/lib/crypto'

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
    if (!workspaceUrl)
      return NextResponse.json(
        { error: 'workspaceUrl is required' },
        { status: 400 }
      )

    const ws = await getUserWorkspace(userId)
    if (!ws || ws.workspace.slug !== workspaceUrl)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const integration = await prisma.slackIntegration.findUnique({
      where: { workspaceId: ws.workspaceId },
      select: { slackTeamName: true, slackUserId: true, slackTeamId: true },
    })

    if (!integration) return NextResponse.json({ connected: false })
    return NextResponse.json({ connected: true, ...integration })
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

    const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
    if (!workspaceUrl)
      return NextResponse.json(
        { error: 'workspaceUrl is required' },
        { status: 400 }
      )

    const ws = await getUserWorkspace(userId)
    if (!ws || ws.workspace.slug !== workspaceUrl)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const memberResult = await requireWorkspaceMember(ws.workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    if (memberResult.role !== 'OWNER') {
      return NextResponse.json(
        { error: 'Only workspace owners can disconnect Slack' },
        { status: 403 }
      )
    }

    const integration = await prisma.slackIntegration.findUnique({
      where: { workspaceId: ws.workspaceId },
      select: { id: true, accessToken: true },
    })
    if (!integration)
      return NextResponse.json({ error: 'Not connected' }, { status: 404 })

    // Revoke token with Slack (fire-and-forget)
    const token = decrypt(integration.accessToken)
    fetch('https://slack.com/api/auth.revoke', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }).catch(err => console.error('[slack] token revoke failed:', err))

    await prisma.slackIntegration.delete({
      where: { workspaceId: ws.workspaceId },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/slack/integration error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
