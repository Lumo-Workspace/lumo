import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import { logger } from '@/lib/logger'

/**
 * GET /api/github/repos?workspaceUrl={slug}
 * The repositories the workspace's GitHub App installation can reach.
 *
 * 404 when the App is not installed — consumers (`useGithubRepos`) read that
 * as "GitHub not connected". The set itself is chosen in GitHub's install
 * settings, so there is no write endpoint here anymore.
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

    const repos = await githubAppInstallService.listRepositories(ws.workspaceId)
    if (!repos) {
      return NextResponse.json(
        { error: 'GitHub App not installed' },
        { status: 404 }
      )
    }

    return NextResponse.json({ repos })
  } catch (error) {
    logger.error(`GET /api/github/repos error: ${String(error)}`)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
