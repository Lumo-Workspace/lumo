import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'

/**
 * GET /api/github/integration?workspaceUrl={slug}
 * Returns the GitHub integration status for the current user.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
    if (!workspaceUrl) {
      return NextResponse.json(
        { error: 'workspaceUrl is required' },
        { status: 400 }
      )
    }

    const ws = await getUserWorkspace(userId)
    if (!ws || ws.workspace.slug !== workspaceUrl) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const integration = await prisma.gitHubIntegration.findUnique({
      where: {
        workspaceId_memberId: {
          workspaceId: ws.workspaceId,
          memberId: ws.member.id,
        },
      },
      select: { githubLogin: true, githubUserId: true, repositories: true },
    })

    if (!integration) {
      return NextResponse.json({ connected: false })
    }

    return NextResponse.json({
      connected: true,
      githubLogin: integration.githubLogin,
      githubUserId: integration.githubUserId,
      repositories: integration.repositories,
    })
  } catch (error) {
    console.error('GET /api/github/integration error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/github/integration?workspaceUrl={slug}
 * Disconnects the GitHub integration for the current user.
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
    if (!workspaceUrl) {
      return NextResponse.json(
        { error: 'workspaceUrl is required' },
        { status: 400 }
      )
    }

    const ws = await getUserWorkspace(userId)
    if (!ws || ws.workspace.slug !== workspaceUrl) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await prisma.gitHubIntegration.delete({
      where: {
        workspaceId_memberId: {
          workspaceId: ws.workspaceId,
          memberId: ws.member.id,
        },
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/github/integration error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
