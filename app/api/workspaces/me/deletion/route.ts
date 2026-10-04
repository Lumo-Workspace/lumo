import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { deleteWorkspaceNowSchema } from '@/lib/validation/schemas'
import { workspaceDeletionService } from '@/lib/services'
import { memberAuditContext } from '@/lib/api/audit-context'

function errorResponse(error: unknown) {
  if (error instanceof Error && 'status' in error) {
    return NextResponse.json(
      { error: error.message },
      { status: (error as Error & { status: number }).status }
    )
  }
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
}

/**
 * DELETE /api/workspaces/me/deletion — Cancel a pending workspace deletion
 * (LUM-918). Any OWNER may cancel; every OWNER is emailed.
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    await workspaceDeletionService.cancelDeletion(
      ws.workspace,
      ws.member.role,
      userId,
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: ws.member.id,
      })
    )
    return NextResponse.json({ pendingDeletion: null })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/workspaces/me/deletion — Run a pending deletion now instead of
 * waiting out the 48 hours (LUM-918; the GDPR immediate-erasure path). OWNER
 * only, and the body must re-type the workspace name.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    const parsed = deleteWorkspaceNowSchema.safeParse(await request.json())
    if (!parsed.success) return zodError(parsed)

    const out = await workspaceDeletionService.deleteNow(
      ws.workspace,
      ws.member.role,
      userId,
      parsed.data.confirmName
    )
    return NextResponse.json({ receiptId: out?.receiptId ?? null })
  } catch (error) {
    return errorResponse(error)
  }
}
