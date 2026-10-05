import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import {
  decodeOauthState,
  completeOauthFlow,
} from '@/lib/services/figma-integration.service'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const errorParam = request.nextUrl.searchParams.get('error')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  if (errorParam || !state) {
    return NextResponse.redirect(`${appUrl}/?figma_error=1`)
  }

  const decoded = decodeOauthState(state)
  if (!decoded) {
    return NextResponse.redirect(`${appUrl}/?figma_error=invalid_state`)
  }

  // Land back on the integrations list (where Slack / GitHub / Sentry also
  // return) — the FigmaIntegrationCard on that page reads the
  // ?connected=1 / ?figma_error=... query param to surface the toast.
  const settingsUrl = `${appUrl}/workspace/${decoded.workspaceUrl}/settings/integrations`

  // Bind callback to the currently authenticated Clerk user: a leaked state
  // blob must not let anyone else complete the OAuth on the encoded member's
  // behalf.
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  // The slug comes from the verified state, never the query string (LUM-989).
  const ws = await getUserWorkspace(authResult.userId, decoded.workspaceUrl)
  if (
    !ws ||
    ws.workspaceId !== decoded.workspaceId ||
    ws.member.id !== decoded.memberId
  ) {
    return NextResponse.redirect(`${settingsUrl}?figma_error=identity_mismatch`)
  }

  if (!code) {
    return NextResponse.redirect(`${settingsUrl}?figma_error=no_code`)
  }

  try {
    await completeOauthFlow({
      workspaceId: decoded.workspaceId,
      memberId: decoded.memberId,
      code,
    })
  } catch (e) {
    const msg = (e as Error).message
    return NextResponse.redirect(
      `${settingsUrl}?figma_error=${encodeURIComponent(msg.slice(0, 64))}`
    )
  }

  return NextResponse.redirect(`${settingsUrl}?connected=1`)
}
