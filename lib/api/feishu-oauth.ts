import { NextRequest, NextResponse } from 'next/server'
import { getUserWorkspace } from '@/lib/auth'
import { resolveAppUrl } from '@/lib/config/public-config'
import {
  decodeOauthState,
  type OauthStatePurpose,
} from '@/lib/integrations/oauth-state'
import { logger } from '@/lib/logger'
import { requireAbsoluteAppUrl } from '@/lib/integrations/feishu/config'

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

/**
 * The configured app URL, or null when NEXT_PUBLIC_APP_URL is missing or not
 * absolute — plus the base to redirect the browser to either way (the request
 * origin as a fallback, so a Location header is never relative; same fallback
 * as app/api/github/app/install/route.ts).
 */
export function feishuAppUrl(request: NextRequest): {
  appUrl: string | null
  base: string
} {
  try {
    const appUrl = requireAbsoluteAppUrl(resolveAppUrl())
    return { appUrl, base: appUrl }
  } catch {
    logger.error(
      '[feishu] NEXT_PUBLIC_APP_URL is not configured; the Feishu OAuth redirect URIs cannot be built'
    )
    return { appUrl: null, base: request.nextUrl.origin }
  }
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
  const { appUrl, base } = feishuAppUrl(request)

  if (!stateParam) return NextResponse.redirect(`${base}/?feishu_error=1`)

  const decoded = decodeOauthState(stateParam, Date.now(), PURPOSE[leg])
  // The slug comes from the verified state, never the query string; an
  // undecodable state only picks the page its error lands on.
  const ws = await getUserWorkspace(
    userId,
    decoded.ok ? decoded.payload.workspaceUrl : undefined
  )
  if (!ws)
    return NextResponse.redirect(`${base}/?feishu_error=identity_mismatch`)
  const settingsUrl = feishuSettingsUrl(base, ws.workspace.slug, leg)
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
  // The token exchange must send the redirect_uri Feishu saw: no app URL, no exchange.
  if (!appUrl) return fail('app_url_not_configured')
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
