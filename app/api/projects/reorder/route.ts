import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { reorderProjectsSchema } from '@/lib/validation/schemas'
import { projectService } from '@/lib/services'

/**
 * PATCH /api/projects/reorder
 * Body: { orderedIds: string[] }
 * Rewrites the Project.order field for every id listed, in the supplied
 * order. All ids must belong to the caller's workspace.
 */
export async function PATCH(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    const body = await request.json()
    const parsed = reorderProjectsSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    await projectService.reorderProjects(
      ws.workspaceId,
      ws.workspace.slug,
      ws.member.id,
      parsed.data.orderedIds
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    const status =
      typeof err === 'object' && err !== null && 'status' in err
        ? (err as { status: number }).status
        : 500
    const message = err instanceof Error ? err.message : 'Internal Server Error'
    return NextResponse.json({ error: message }, { status })
  }
}
