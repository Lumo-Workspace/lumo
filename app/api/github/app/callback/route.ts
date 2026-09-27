import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { decrypt } from '@/lib/crypto'
import { githubAppInstallService } from '@/lib/services/github-app-install.service'
import { logger } from '@/lib/logger'

interface VerifyState {
  workspaceId: string
  workspaceUrl: string
  memberId: string
  installationId: number
}

function parseState(raw: string | null): VerifyState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(decrypt(raw)) as Partial<VerifyState>
    if (
      !parsed.workspaceId ||
      !parsed.workspaceUrl ||
      !Number.isInteger(parsed.installationId) ||
      (parsed.installationId as number) <= 0
    ) {
      return null
    }
    return parsed as VerifyState
  } catch {
    return null
  }
}

const ERROR_CODES = new Set(['verify_not_configured', 'not_authorized'])

/**
 * GET /api/github/app/callback?code={code}&state={state}
 *
 * LUM-875 — second leg of the install callback. /api/github/app/setup sent the
 * user to authorize the Lumo GitHub App; GitHub returns here with a code for
 * that user. The installation from the signed state is recorded only when
 * GitHub lists it among the installations this user can access — the
 * `installation_id` on the setup URL is attacker-controlled on its own.
 *
 * Membership of the state's workspace is re-checked here: the state names the
 * workspace, the signed-in caller must belong to it.
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

  const ws = await getUserWorkspace(userId)
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

  // No code means the user declined to authorize (`error=access_denied`):
  // without GitHub vouching for them there is nothing we may record.
  const code = searchParams.get('code')
  if (!code) {
    return NextResponse.redirect(
      `${settingsUrl}?github_app_error=not_authorized`
    )
  }

  try {
    await githubAppInstallService.install({
      workspaceId: ws.workspaceId,
      memberId: ws.member.id,
      installationId: state.installationId,
      userCode: code,
      redirectUri: `${process.env.NEXT_PUBLIC_APP_URL}/api/github/app/callback`,
    })
  } catch (error) {
    logger.error(
      `[github/app/callback] refused installation ${state.installationId} for workspace ${ws.workspaceId}: ${String(error)}`
    )
    const reason = (error as { code?: string }).code
    const errorCode =
      reason && ERROR_CODES.has(reason) ? reason : 'install_failed'
    return NextResponse.redirect(`${settingsUrl}?github_app_error=${errorCode}`)
  }

  return NextResponse.redirect(`${settingsUrl}?github_app=installed`)
}
