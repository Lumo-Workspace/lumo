import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { setAiFeatureSwitchSchema } from '@/lib/validation/schemas'
import { aiFeaturesService } from '@/lib/services'
import { memberAuditContext } from '@/lib/api/audit-context'

function errorResponse(error: unknown) {
  if (error instanceof Error && 'status' in error) {
    const { status, code } = error as Error & { status: number; code?: string }
    return NextResponse.json(
      { error: error.message, ...(code && { code }) },
      { status }
    )
  }
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
}

/**
 * GET /api/workspaces/me/ai-features — whether the deployment has a model,
 * the stored switches and each feature's effective state (LUM-1338). Any
 * member: the UI hides AI entry points from it.
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult

    const ws = await requireUserWorkspace(authResult.userId)
    if (ws instanceof NextResponse) return ws

    return NextResponse.json(await aiFeaturesService.getStatus(ws.workspaceId))
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * PATCH /api/workspaces/me/ai-features — set one switch (OWNER only). 409
 * `AI_NOT_CONFIGURED` when turning the master switch on without a model.
 */
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult

    const ws = await requireUserWorkspace(authResult.userId)
    if (ws instanceof NextResponse) return ws

    const parsed = setAiFeatureSwitchSchema.safeParse(await request.json())
    if (!parsed.success) return zodError(parsed)

    const { enabled, ...key } = parsed.data
    const status = await aiFeaturesService.setSwitch(
      { id: ws.workspaceId, slug: ws.workspace.slug },
      ws.member.role,
      key,
      enabled,
      memberAuditContext(request.headers, {
        clerkId: authResult.userId,
        memberId: ws.member.id,
      })
    )
    return NextResponse.json(status)
  } catch (error) {
    return errorResponse(error)
  }
}
