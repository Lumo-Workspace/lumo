import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { decrypt } from '@/lib/crypto'
import { deleteRepoWebhook } from '@/lib/integrations/github'
import { githubService } from '@/lib/services/github.service'
import { logger } from '@/lib/logger'
import { memberAuditContext } from '@/lib/api/audit-context'

/**
 * GET /api/github/integration?workspaceUrl={slug}
 * Returns the GitHub integration status for the current user.
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

    const status = await githubService.getIntegrationStatus(
      ws.workspaceId,
      ws.member.id
    )

    return NextResponse.json(status)
  } catch (error) {
    logger.error('GET /api/github/integration error:', error)
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

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const integration = await githubService
      .requireIntegrationWithWebhooks(ws.workspaceId, ws.member.id)
      .catch(() => null)

    if (integration) {
      const token = decrypt(integration.accessToken)
      for (const hook of integration.webhooks) {
        const slash = hook.repo.indexOf('/')
        const owner = hook.repo.slice(0, slash)
        const repo = hook.repo.slice(slash + 1)
        try {
          await deleteRepoWebhook(token, owner, repo, hook.githubHookId)
        } catch (err) {
          logger.error(
            `[github] failed to delete webhook ${hook.repo}#${hook.githubHookId}:`,
            err
          )
        }
      }
      // Cascade delete handles GitHubWebhook records
      await githubService.deleteIntegration(
        { id: integration.id, workspaceId: ws.workspaceId },
        memberAuditContext(request.headers, {
          clerkId: userId,
          memberId: ws.member.id,
        })
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    logger.error('DELETE /api/github/integration error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
