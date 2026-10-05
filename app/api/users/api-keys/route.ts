import { NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { serviceErrorResponse } from '@/lib/api/helpers'
import { memberAuditContext } from '@/lib/api/audit-context'
import { apiKeyService } from '@/lib/services/api-key.service'

/**
 * GET /api/users/api-keys
 * Lists active (non-revoked) API keys for the current user.
 * Never returns the full key — only prefix and metadata.
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const keys = await apiKeyService.list({
      workspaceId: ws.workspaceId,
      memberId: ws.member.id,
    })
    return NextResponse.json({ keys })
  } catch (error) {
    return serviceErrorResponse(error, 'GET /api/users/api-keys')
  }
}

/**
 * POST /api/users/api-keys
 * Creates a new API key. Returns the full key ONCE — never stored in plaintext.
 * Body: { label: string, scope?: string }
 */
export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const body = await request.json()
    const created = await apiKeyService.create(
      { workspaceId: ws.workspaceId, memberId: ws.member.id },
      { label: String(body?.label ?? ''), scope: body?.scope },
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: ws.member.id,
      })
    )
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return serviceErrorResponse(error, 'POST /api/users/api-keys')
  }
}
