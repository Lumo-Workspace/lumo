import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { startPlanRunSchema } from '@/lib/validation/plan-run'
import { planRunService } from '@/lib/services'

/**
 * POST /api/plan-runs
 *
 * Start a design-thinking 转换器 run for the workspace's default team (LUM-668,
 * `lumo plan`). Auth via Clerk (web) or Bearer (CLI). The service freezes the
 * input snapshot, enforces one active run per team, and creates the run in
 * CLUSTERING. Returns 409 when a run is already active unless `abandonActive`
 * is passed (abandons the prior run first), 404 when there is no default team.
 */
export async function POST(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  let body: unknown
  try {
    body = await request.json()
  } catch {
    // An empty body is valid (no override) — default to {}.
    body = {}
  }

  const parsed = startPlanRunSchema.safeParse(body ?? {})
  if (!parsed.success) return zodError(parsed)

  try {
    const run = await planRunService.startRun({
      workspaceId: identity.workspaceId,
      memberId: identity.memberId,
      ...(parsed.data.abandonActive !== undefined && {
        abandonActive: parsed.data.abandonActive,
      }),
    })
    return NextResponse.json({ run }, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'POST /api/plan-runs')
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
