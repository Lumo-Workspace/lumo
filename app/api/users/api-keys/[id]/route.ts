import { NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { serviceErrorResponse } from '@/lib/api/helpers'
import { memberAuditContext } from '@/lib/api/audit-context'
import { apiKeyService } from '@/lib/services/api-key.service'

/**
 * DELETE /api/users/api-keys/:id
 * Revokes (soft-deletes) an API key. Only the owner can revoke their own keys.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const { id } = await params
    await apiKeyService.revoke(
      { workspaceId: ws.workspaceId, memberId: ws.member.id },
      id,
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: ws.member.id,
      })
    )
    return NextResponse.json({ ok: true })
  } catch (error) {
    return serviceErrorResponse(error, 'DELETE /api/users/api-keys')
  }
}
