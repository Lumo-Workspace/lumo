import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { updateWorkspaceSchema } from '@/lib/validation/schemas'
import { workspaceService, workspaceDeletionService } from '@/lib/services'
import { platformSecurityCeiling } from '@/lib/security-scan/workspace-switches'

/**
 * GET /api/workspaces/me — Get the current user's workspace.
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const result = await requireUserWorkspace(userId)
    if (result instanceof NextResponse) return result

    return NextResponse.json({
      workspace: result.workspace,
      role: result.member.role,
      // LUM-866: which scan layers the platform allows at all — the settings
      // page shows a layer the env turned off as off and not toggleable.
      securityPlatform: platformSecurityCeiling(),
      // LUM-918: the pending deletion (null when none) — drives the banner
      // every member sees and the owner's cancel / delete-now controls.
      pendingDeletion: await workspaceDeletionService.getPending(
        result.workspaceId
      ),
    })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/workspaces/me — Update workspace name and/or slug.
 * Caller must be an OWNER.
 */
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    const body = await request.json()
    const parsed = updateWorkspaceSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const updated = await workspaceService.updateWorkspace(
      ws.workspaceId,
      ws.member.role,
      ws.workspace.slug,
      parsed.data
    )

    return NextResponse.json({ workspace: updated })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/workspaces/me — Schedule the workspace for deletion (LUM-918).
 * Caller must be an OWNER. Nothing is removed yet: every OWNER is emailed and
 * any of them can cancel for 48 hours; the cron then runs the full LUM-861
 * purge (rows, blobs, deletion receipt).
 */
export async function DELETE() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    const pendingDeletion = await workspaceDeletionService.scheduleDeletion(
      ws.workspace,
      ws.member.role,
      userId
    )

    return NextResponse.json({ pendingDeletion }, { status: 202 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
