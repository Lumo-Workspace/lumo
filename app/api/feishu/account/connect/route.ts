import { NextRequest, NextResponse } from 'next/server'
import { requireIntegrationConfigured } from '@/lib/api/integration-configured'
import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { feishuFlowFailure, feishuSettingsUrl } from '@/lib/api/feishu-oauth'
import { resolveAppUrl } from '@/lib/config/public-config'
import { buildAccountAuthorizeUrl } from '@/lib/services/feishu-integration.service'

/**
 * GET /api/feishu/account/connect?workspaceUrl= — LUM-1341: a member links
 * their own Feishu account (the workspace must have the app installed).
 */
export async function GET(request: NextRequest) {
  const notConfigured = requireIntegrationConfigured('feishuAccount')
  if (notConfigured) return notConfigured
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
  const ws = await requireWorkspaceByUrl(authResult.userId, workspaceUrl)
  if (ws instanceof NextResponse) return ws

  const appUrl = resolveAppUrl() ?? ''
  try {
    const url = await buildAccountAuthorizeUrl({
      workspaceId: ws.workspaceId,
      memberId: ws.member.id,
      workspaceUrl: ws.workspace.slug,
      appUrl,
    })
    return NextResponse.redirect(url)
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return feishuFlowFailure(
      feishuSettingsUrl(appUrl, ws.workspace.slug, 'account'),
      error,
      'account start'
    )
  }
}
