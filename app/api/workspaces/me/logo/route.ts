import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { serviceErrorResponse } from '@/lib/api/helpers'
import { memberAuditContext } from '@/lib/api/audit-context'
import { workspaceLogoService } from '@/lib/services/workspace-logo.service'

/**
 * POST /api/workspaces/me/logo
 * Accepts multipart/form-data with a "file" field. OWNER only — the check,
 * validation, blob swap and audit event live in workspaceLogoService.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const formData = await request.formData()
    const result = await workspaceLogoService.updateLogo(
      {
        workspaceId: ws.workspaceId,
        role: ws.member.role,
        currentLogoUrl: ws.workspace.logoUrl ?? null,
      },
      formData.get('file'),
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: ws.member.id,
      })
    )
    return NextResponse.json(result)
  } catch (error) {
    return serviceErrorResponse(error, 'POST /api/workspaces/me/logo')
  }
}
