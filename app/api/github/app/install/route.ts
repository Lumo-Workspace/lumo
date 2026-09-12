import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { encrypt } from '@/lib/crypto'

/**
 * GET /api/github/app/install?workspaceUrl={slug}
 *
 * Starts the GitHub App installation by redirecting to the App's install page,
 * carrying an encrypted state that names the workspace the installation should
 * land on. GitHub hands that state back to /api/github/app/setup, which still
 * re-checks the caller's membership — the state carries context, not authority.
 *
 * Separate from /api/github/oauth on purpose: OAuth authorizes a person (repo
 * listing, PR links, repo webhooks), the App installation authorizes a machine
 * identity scoped to `contents:read` that the managed security scan clones with.
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

  const ws = await getUserWorkspace(userId)
  if (!ws || ws.workspace.slug !== workspaceUrl) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const appSlug = process.env.GITHUB_APP_SLUG
  if (!appSlug) {
    return NextResponse.json(
      { error: 'GitHub App not configured' },
      { status: 500 }
    )
  }

  const state = encrypt(
    JSON.stringify({
      memberId: ws.member.id,
      workspaceId: ws.workspaceId,
      workspaceUrl,
    })
  )

  return NextResponse.redirect(
    `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(state)}`
  )
}
