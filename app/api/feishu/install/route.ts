import { NextRequest, NextResponse } from 'next/server'
import { requireIntegrationConfigured } from '@/lib/api/integration-configured'
import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import {
  feishuAppUrl,
  feishuFlowFailure,
  feishuSettingsUrl,
} from '@/lib/api/feishu-oauth'
import { buildInstallAuthorizeUrl } from '@/lib/services/feishu-integration.service'

/**
 * GET /api/feishu/install?workspaceUrl= — LUM-1341: an owner signs in with
 * Feishu to bind this workspace to the app's tenant.
 */
export async function GET(request: NextRequest) {
  const notConfigured = requireIntegrationConfigured('feishu')
  if (notConfigured) return notConfigured
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
  const ws = await requireWorkspaceByUrl(authResult.userId, workspaceUrl)
  if (ws instanceof NextResponse) return ws

  const { appUrl, base } = feishuAppUrl(request)
  const settingsUrl = feishuSettingsUrl(base, ws.workspace.slug, 'install')
  if (!appUrl) {
    return NextResponse.redirect(
      `${settingsUrl}?feishu_error=app_url_not_configured`
    )
  }
  try {
    const url = buildInstallAuthorizeUrl({
      workspaceId: ws.workspaceId,
      memberId: ws.member.id,
      workspaceUrl: ws.workspace.slug,
      role: ws.member.role,
      appUrl,
    })
    return NextResponse.redirect(url)
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return feishuFlowFailure(settingsUrl, error, 'install start')
  }
}
