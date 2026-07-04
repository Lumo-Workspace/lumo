import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { initiativeService } from '@/lib/services/initiative.service'

/**
 * GET /api/initiatives
 *
 * The caller team's materialised initiatives (list). Auth via Clerk (web) or
 * Bearer (CLI). Scoped to the workspace's default team; never leaks another
 * team's initiatives.
 */
export async function GET(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  try {
    const initiatives = await initiativeService.listForWorkspace({
      workspaceId: identity.workspaceId,
    })
    return NextResponse.json({ initiatives })
  } catch (err) {
    return errorResponse(err, 'GET /api/initiatives')
  }
}

function errorResponse(err: unknown, tag: string): NextResponse {
  const errStatus = (err as { status?: unknown })?.status
  const status = typeof errStatus === 'number' ? errStatus : 500
  if (status === 500) {
    console.error(`${tag} error:`, err)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
  const message = err instanceof Error ? err.message : 'Error'
  return NextResponse.json({ error: message }, { status })
}
