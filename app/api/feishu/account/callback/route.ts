import { NextRequest, NextResponse } from 'next/server'
import { requireIntegrationConfigured } from '@/lib/api/integration-configured'
import { requireAuth } from '@/lib/auth'
import { memberAuditContext } from '@/lib/api/audit-context'
import { feishuFlowFailure, verifyFeishuCallback } from '@/lib/api/feishu-oauth'
import { completeAccountLink } from '@/lib/services/feishu-integration.service'

/**
 * GET /api/feishu/account/callback?code=&state= — LUM-1341: finish a
 * member's account link (state checks in lib/api/feishu-oauth.ts).
 */
export async function GET(request: NextRequest) {
  const notConfigured = requireIntegrationConfigured('feishuAccount')
  if (notConfigured) return notConfigured
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const cb = await verifyFeishuCallback(request, authResult.userId, 'account')
  if (cb instanceof NextResponse) return cb
  try {
    await completeAccountLink(
      {
        workspaceId: cb.workspaceId,
        memberId: cb.memberId,
        code: cb.code,
        appUrl: cb.appUrl,
      },
      memberAuditContext(request.headers, {
        clerkId: cb.userId,
        memberId: cb.memberId,
      })
    )
  } catch (error) {
    return feishuFlowFailure(cb.settingsUrl, error, 'account callback')
  }
  return NextResponse.redirect(`${cb.settingsUrl}?feishu_connected=1`)
}
