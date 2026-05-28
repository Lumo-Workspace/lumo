import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getAuthorizeUrl } from '@/lib/integrations/figma/oauth'
import { encodeOauthState } from '@/lib/services/figma-integration.service'

export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
  if (!workspaceUrl) {
    return NextResponse.json(
      { error: 'workspaceUrl is required' },
      { status: 400 }
    )
  }

  const ws = await getUserWorkspace(userId)
  if (!ws || ws.workspace.slug !== workspaceUrl) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const state = encodeOauthState({
    memberId: ws.member.id,
    workspaceId: ws.workspaceId,
    workspaceUrl,
  })

  return NextResponse.redirect(getAuthorizeUrl({ state }))
}
