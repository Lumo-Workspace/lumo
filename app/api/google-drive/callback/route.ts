import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { memberAuditContext } from '@/lib/api/audit-context'
import {
  decodeOauthState,
  completeOauthFlow,
} from '@/lib/services/google-drive-integration.service'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const errorParam = request.nextUrl.searchParams.get('error')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  if (errorParam || !state) {
    return NextResponse.redirect(`${appUrl}/?google_error=1`)
  }

  const decoded = decodeOauthState(state)
  if (!decoded) {
    return NextResponse.redirect(`${appUrl}/?google_error=invalid_state`)
  }

  const settingsUrl = `${appUrl}/workspace/${decoded.workspaceUrl}/settings/integrations`

  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const ws = await getUserWorkspace(authResult.userId)
  if (
    !ws ||
    ws.workspaceId !== decoded.workspaceId ||
    ws.member.id !== decoded.memberId
  ) {
    return NextResponse.redirect(
      `${settingsUrl}?google_error=identity_mismatch`
    )
  }

  if (!code) {
    return NextResponse.redirect(`${settingsUrl}?google_error=no_code`)
  }

  try {
    await completeOauthFlow(
      {
        workspaceId: decoded.workspaceId,
        memberId: decoded.memberId,
        code,
      },
      memberAuditContext(request.headers, {
        clerkId: authResult.userId,
        memberId: ws.member.id,
      })
    )
  } catch (e) {
    const msg = (e as Error).message
    return NextResponse.redirect(
      `${settingsUrl}?google_error=${encodeURIComponent(msg.slice(0, 64))}`
    )
  }

  return NextResponse.redirect(`${settingsUrl}?google_connected=1`)
}
