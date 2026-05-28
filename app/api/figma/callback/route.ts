import { NextRequest, NextResponse } from 'next/server'
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

  const settingsUrl = `${appUrl}/workspace/${decoded.workspaceUrl}/settings/integrations/figma`
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
