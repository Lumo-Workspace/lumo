import { NextResponse } from 'next/server'
import { waitUntil } from '@/lib/runtime/wait-until'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { planRunService } from '@/lib/services/plan-run.service'
import { triggerAlignStage } from '@/lib/services/plan-align-runner'
import { confirmClusterGateSchema } from '@/lib/validation/plan-run'

// Confirming gate A triggers Stage-2 (对齐) — another reasoning-model LLM call
// on the same order as Stage-1's ~70s. Give it the same headroom over the
// ~60s platform default so it isn't killed mid-call (LUM-676).
export const maxDuration = 300

type Params = { params: Promise<{ runId: string }> }

/** Map a service error carrying `{ status }` to its Response; rethrow the rest
 *  (a genuine 500). */
function errorResponse(error: unknown): NextResponse {
  if (error instanceof Error && 'status' in error) {
    return NextResponse.json(
      { error: error.message },
      { status: (error as Error & { status: number }).status }
    )
  }
  throw error
}

/**
 * GET /api/plan-runs/[runId]/gate/cluster — the gate-A (闸门A) board: the run's
 * stage, the editable clustering (confirmed edit if any, else the Stage-1 raw
 * output), its optimistic-concurrency `revision`, and the referenced ideas'
 * statements. Workspace-scoped — another workspace's run 404s.
 */
export async function GET(request: Request, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { runId } = await params
  try {
    const view = await planRunService.getClusterGateView({
      planRunId: runId,
      workspaceId: identity.workspaceId,
    })
    return NextResponse.json(view)
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/plan-runs/[runId]/gate/cluster — confirm gate A: persist the reviewer's
 * edited clustering, advance the run to ALIGNING, and trigger Stage-2 (对齐)
 * out of band via `waitUntil` (fail-soft — never blocks or fails the confirm).
 *
 * 400 invalid body · 404 run not found / not this workspace · 409 gate closed
 * or stale revision · 422 the edit doesn't partition the original idea set.
 */
export async function POST(request: Request, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { runId } = await params
  const body = await request.json().catch(() => null)
  const parsed = confirmClusterGateSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const run = await planRunService.confirmClusterGate({
      planRunId: runId,
      workspaceId: identity.workspaceId,
      edited: { clusters: parsed.data.clusters, orphans: parsed.data.orphans },
      ifRevision: parsed.data.ifRevision,
      confirmedBy: identity.memberId,
    })
    waitUntil(triggerAlignStage(run.id))
    return NextResponse.json({ run })
  } catch (error) {
    return errorResponse(error)
  }
}
