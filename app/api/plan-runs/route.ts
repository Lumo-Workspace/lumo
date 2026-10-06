import { NextResponse } from 'next/server'
import { waitUntil } from '@/lib/runtime/wait-until'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { startPlanRunSchema } from '@/lib/validation/plan-run'
import { planRunService } from '@/lib/services'
import { triggerClusterStage } from '@/lib/services/plan-cluster-runner'

// Stage-1 (聚类) runs a reasoning-model LLM call that measures ~70s locally
// (deepseek-v4-pro). Without this, the function inherits the platform default
// (~60s) and is killed mid-call → run lands FAILED (LUM-676). 300s is the
// Vercel Pro ceiling and leaves ample headroom.
export const maxDuration = 300

/**
 * POST /api/plan-runs
 *
 * Start a design-thinking 转换器 run for the workspace's default team (LUM-668,
 * `lumo plan`). Auth via Clerk (web) or Bearer (CLI). The service freezes the
 * input snapshot, enforces one active run per team, and creates the run in
 * CLUSTERING. Returns 409 when a run is already active unless `abandonActive`
 * is passed (abandons the prior run first), 404 when there is no default team.
 *
 * Stage-1 (聚类) is then triggered out of band via `waitUntil` (fail-soft —
 * never blocks or fails the response): it advances the run CLUSTERING →
 * CLUSTERS_READY so gate A actually opens instead of sitting stuck (LUM-674).
 */
/**
 * GET /api/plan-runs
 *
 * List the caller team's plan runs — the active run plus terminal ones
 * (MATERIALIZED / ABANDONED / FAILED), newest first (LUM-677). Team-scoped by
 * the service so one team's runs never leak into another's list. Powers the
 * Ideas-page plan-runs surface, so runs are reachable without the CLI deep-link.
 */
export async function GET(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  try {
    const runs = await planRunService.listRuns({
      workspaceId: identity.workspaceId,
    })
    return NextResponse.json({ runs })
  } catch (err) {
    return errorResponse(err, 'GET /api/plan-runs')
  }
}

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
    waitUntil(triggerClusterStage(run.id))
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
