import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'

/**
 * GET /api/github/authorized-repos?workspaceUrl={slug}
 *
 * Returns the repositories that are authorized in any GitHub integration
 * for this workspace (stored in the DB). Does NOT require the current user
 * to have personally connected GitHub — only workspace membership is required.
 *
 * Used by CreateBranchDialog to populate the repo selector.
 */
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

    const memberResult = await requireWorkspaceMember(ws.workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    // Collect all repos authorized across all integrations for this workspace
    const integrations = await prisma.gitHubIntegration.findMany({
      where: { workspaceId: ws.workspaceId },
      select: { repositories: true },
    })

    const allRepos = integrations.flatMap(i => i.repositories)
    // Deduplicate (in case multiple integrations authorize the same repo)
    const unique = [...new Set(allRepos)]

    const repos = unique.map(fullName => ({
      fullName,
      name: fullName.split('/')[1] ?? fullName,
      private: false, // privacy info not stored; omit for branch creation purposes
    }))

    return NextResponse.json({ repos })
  } catch (error) {
    console.error('GET /api/github/authorized-repos error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
