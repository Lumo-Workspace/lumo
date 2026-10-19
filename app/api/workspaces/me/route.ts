import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { workspaceService, workspaceDeletionService } from '@/lib/services'
import {
  pluginMeFields,
  serializeWorkspaceSettings,
  unownedWorkspaceColumns,
  workspaceSettingsUpdateSchema,
} from '@/lib/plugins/workspace-settings'
import { memberAuditContext } from '@/lib/api/audit-context'

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
      // LUM-1062: the core columns plus those an installed plugin owns.
      workspace: serializeWorkspaceSettings(result.workspace),
      role: result.member.role,
      // LUM-1062: plugin fields (the security plugin: `securityPlatform`);
      // never one of the core's own fields.
      ...pluginMeFields(
        ['workspace', 'role', 'pendingDeletion'],
        result.workspaceId
      ),
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
    // LUM-1062: a setting owned by a plugin this server does not have.
    const unowned =
      body && typeof body === 'object' ? unownedWorkspaceColumns(body) : []
    if (unowned.length > 0) {
      return NextResponse.json(
        {
          error: `Not available on this server: ${unowned.join(', ')}`,
        },
        { status: 400 }
      )
    }
    const parsed = workspaceSettingsUpdateSchema().safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const updated = await workspaceService.updateWorkspace(
      ws.workspaceId,
      ws.member.role,
      ws.workspace.slug,
      parsed.data,
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: ws.member.id,
      })
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
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    const pendingDeletion = await workspaceDeletionService.scheduleDeletion(
      ws.workspace,
      ws.member.role,
      userId,
      new Date(),
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: ws.member.id,
      })
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
