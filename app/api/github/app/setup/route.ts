import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { decrypt, encrypt } from '@/lib/crypto'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import { logger } from '@/lib/logger'

interface InstallState {
  workspaceId: string
  workspaceUrl: string
  memberId: string
}

function parseState(raw: string | null): InstallState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(decrypt(raw)) as Partial<InstallState>
    if (!parsed.workspaceId || !parsed.workspaceUrl) return null
    return parsed as InstallState
  } catch {
    return null
  }
}

/**
 * GET /api/github/app/setup?installation_id={id}&setup_action={action}&state={state}
 *
 * Where GitHub sends the user back after installing (or updating) the Lumo
 * GitHub App, carrying the signed `state` we minted in /api/github/app/install.
 *
 * The state alone is not trusted for authorization — a user could replay
 * someone else's link — so the signed-in caller must be a member of the
 * workspace the state names. Nor is `installation_id`: GitHub documents it as
 * attacker-controlled, and the App can read any installation it has (LUM-875).
 * So this route writes nothing. It hands the user to GitHub to authorize the
 * App, and /api/github/app/callback records the installation only once GitHub
 * confirms this user can access it. Every failure is reported explicitly
 * rather than redirected away silently.
 */
export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const { searchParams } = request.nextUrl
  const state = parseState(searchParams.get('state'))
  if (!state) {
    return NextResponse.json(
      {
        error:
          'This installation link is missing or invalid. Start the installation from your workspace integration settings.',
      },
      { status: 400 }
    )
  }

  // The slug comes from the signed state, never the query string (LUM-989).
  const ws = await getUserWorkspace(userId, state.workspaceUrl)
  if (!ws || ws.workspaceId !== state.workspaceId) {
    return NextResponse.json(
      {
        error:
          'You are not a member of the workspace this installation was started from.',
      },
      { status: 403 }
    )
  }

  // The redirect target comes from the membership lookup, never from the
  // state: the settings path is ours to decide, not the query string's.
  const settingsUrl = `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${encodeURIComponent(ws.workspace.slug)}/settings/integrations`

  const installationId = Number(searchParams.get('installation_id'))
  if (!Number.isInteger(installationId) || installationId <= 0) {
    return NextResponse.json(
      { error: 'GitHub did not return a valid installation id.' },
      { status: 400 }
    )
  }

  // `request` means the user asked an org owner to approve the install — there
  // is no installation to record yet.
  if (searchParams.get('setup_action') === 'request') {
    return NextResponse.redirect(`${settingsUrl}?github_app=requested`)
  }

  const verifyState = encrypt(
    JSON.stringify({
      workspaceId: ws.workspaceId,
      workspaceUrl: ws.workspace.slug,
      memberId: ws.member.id,
      installationId,
    })
  )

  try {
    return NextResponse.redirect(
      githubAppInstallService.userAuthorizeUrl(
        verifyState,
        `${process.env.NEXT_PUBLIC_APP_URL}/api/github/app/callback`
      )
    )
  } catch (error) {
    logger.error(
      `[github/app/setup] cannot verify installation ${installationId} for workspace ${ws.workspaceId}: ${String(error)}`
    )
    const code =
      (error as { code?: string }).code === 'verify_not_configured'
        ? 'verify_not_configured'
        : 'install_failed'
    return NextResponse.redirect(`${settingsUrl}?github_app_error=${code}`)
  }
}
