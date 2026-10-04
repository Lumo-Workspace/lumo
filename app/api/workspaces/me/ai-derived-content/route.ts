import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { purgeAiDerivedContentSchema } from '@/lib/validation/schemas'
import { aiDerivedContentService } from '@/lib/services'
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
 * GET /api/workspaces/me/ai-derived-content — the AI-derived content switch
 * and how many memories / session summaries / run summaries are stored
 * (LUM-917). OWNER only.
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult

    const ws = await requireUserWorkspace(authResult.userId)
    if (ws instanceof NextResponse) return ws

    const status = await aiDerivedContentService.getStatus(
      ws.workspaceId,
      ws.member.role
    )
    return NextResponse.json(status)
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/workspaces/me/ai-derived-content — delete the workspace's
 * memories and clear its session / run summaries, one batched pass per call
 * (`done: false` → call again). OWNER only; the body re-types the workspace
 * name (LUM-917).
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult

    const ws = await requireUserWorkspace(authResult.userId)
    if (ws instanceof NextResponse) return ws

    const parsed = purgeAiDerivedContentSchema.safeParse(await request.json())
    if (!parsed.success) return zodError(parsed)

    const result = await aiDerivedContentService.purge(
      { id: ws.workspaceId, name: ws.workspace.name },
      ws.member.role,
      parsed.data.confirmName,
      memberAuditContext(request.headers, {
        clerkId: authResult.userId,
        memberId: ws.member.id,
      })
    )
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
