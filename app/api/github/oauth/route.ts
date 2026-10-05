import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { encodeOauthState } from '@/lib/integrations/oauth-state'

/**
 * GET /api/github/oauth?workspaceUrl={slug}
 * Initiates the GitHub OAuth flow by redirecting to GitHub's authorization page.
 *
 * This grant is an identity link only: it records which GitHub login belongs
 * to this member, so comments arriving from GitHub can be attributed to them
 * in Lumo. Everything that reads or writes repositories — listing, PR links,
 * webhooks, comment mirroring, the security scan — runs as the workspace's App
 * installation, so no repository scope is requested here.
 */
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

  // A full-page redirect carries no X-Lumo-Workspace header, so name the
  // workspace explicitly; the slug check still refuses a single-workspace
  // user asking for someone else's workspace (LUM-989).
  const ws = await getUserWorkspace(userId, workspaceUrl)
  if (!ws || ws.workspace.slug !== workspaceUrl) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const clientId = process.env.GITHUB_CLIENT_ID
  if (!clientId) {
    return NextResponse.json(
      { error: 'GitHub OAuth not configured' },
      { status: 500 }
    )
  }

  // Encrypted, short-lived state; the callback also re-checks the signed-in
  // member against it (LUM-982).
  const state = encodeOauthState({
    memberId: ws.member.id,
    workspaceId: ws.workspaceId,
    workspaceUrl,
  })

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/github/callback`,
    scope: 'read:user',
    state,
  })

  return NextResponse.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`
  )
}
