import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { planRunService } from '@/lib/services'

/**
 * GET /api/plan-runs/active
 *
 * The workspace default team's currently active 转换器 run, or `null` (LUM-668,
 * `lumo plan status`). Auth via Clerk (web) or Bearer (CLI). "Active" = any
 * non-terminal stage; a run in MATERIALIZED / ABANDONED reads as no active run.
 * Returns 404 when there is no default team.
 */
export async function GET(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  try {
    const run = await planRunService.getActiveRun({
      workspaceId: identity.workspaceId,
    })
    return NextResponse.json({ run })
  } catch (err) {
    return errorResponse(err, 'GET /api/plan-runs/active')
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
