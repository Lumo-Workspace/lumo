import { NextRequest, NextResponse } from 'next/server'
import { getUserWorkspace } from '@/lib/auth'
import { resolveAppUrl } from '@/lib/config/public-config'
import {
  decodeOauthState,
  type OauthStatePurpose,
} from '@/lib/integrations/oauth-state'
import { logger } from '@/lib/logger'

/**
 * LUM-1341 — what both Feishu OAuth callbacks share: the state must be ours,
 * fresh, minted for THIS leg, and the signed-in member must be the one who
 * started the flow in the workspace the state names (LUM-982 / LUM-989).
 * Anything else lands back on the settings page with `feishu_error=<reason>`.
 */

export type FeishuLeg = 'install' | 'account'

const PURPOSE: Record<FeishuLeg, OauthStatePurpose> = {
  install: 'feishu-install',
  account: 'feishu-account',
}

const SETTINGS_PAGE: Record<FeishuLeg, string> = {
  install: 'integrations',
  account: 'connected-accounts',
}

export function feishuSettingsUrl(
  appUrl: string,
  workspaceSlug: string,
  leg: FeishuLeg
): string {
  return `${appUrl}/workspace/${workspaceSlug}/settings/${SETTINGS_PAGE[leg]}`
}

export interface VerifiedFeishuCallback {
  code: string
  appUrl: string
  settingsUrl: string
  userId: string
  workspaceId: string
  memberId: string
  role: string
}

/** `userId` is the signed-in user — the route authenticates first (requireAuth). */
export async function verifyFeishuCallback(
  request: NextRequest,
  userId: string,
  leg: FeishuLeg
): Promise<VerifiedFeishuCallback | NextResponse> {
  const params = request.nextUrl.searchParams
  const code = params.get('code')
  const stateParam = params.get('state')
  const appUrl = resolveAppUrl() ?? ''

  if (!stateParam) return NextResponse.redirect(`${appUrl}/?feishu_error=1`)

  const decoded = decodeOauthState(stateParam, Date.now(), PURPOSE[leg])
  // The slug comes from the verified state, never the query string; an
  // undecodable state only picks the page its error lands on.
  const ws = await getUserWorkspace(
    userId,
    decoded.ok ? decoded.payload.workspaceUrl : undefined
  )
  if (!ws)
    return NextResponse.redirect(`${appUrl}/?feishu_error=identity_mismatch`)
  const settingsUrl = feishuSettingsUrl(appUrl, ws.workspace.slug, leg)
  const fail = (reason: string) =>
    NextResponse.redirect(`${settingsUrl}?feishu_error=${reason}`)

  if (!decoded.ok) {
    return fail(decoded.reason === 'expired' ? 'expired' : 'invalid_state')
  }
  const { workspaceId, memberId } = decoded.payload
  if (ws.workspaceId !== workspaceId || ws.member.id !== memberId) {
    return fail('identity_mismatch')
  }
  if (params.get('error')) return fail('denied')
  if (!code) return fail('no_code')

  return {
    code,
    appUrl,
    settingsUrl,
    userId,
    workspaceId,
    memberId,
    role: ws.member.role,
  }
}

/** Map a service error to the reason put in the redirect; never a token. */
export function feishuFlowFailure(
  settingsUrl: string,
  error: unknown,
  where: string
): NextResponse {
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && /^[a-z_]{1,32}$/.test(code)) {
    return NextResponse.redirect(`${settingsUrl}?feishu_error=${code}`)
  }
  logger.error(
    `[feishu] ${where} failed: ${(error as Error)?.message ?? String(error)}`
  )
  return NextResponse.redirect(`${settingsUrl}?feishu_error=1`)
}
