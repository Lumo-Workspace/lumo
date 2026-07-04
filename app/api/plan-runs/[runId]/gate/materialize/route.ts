import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { materializePlanSchema } from '@/lib/validation/plan-run'
import { planMaterializeService } from '@/lib/services'

export const runtime = 'nodejs'

type Params = { params: Promise<{ runId: string }> }

/**
 * GET /api/plan-runs/[runId]/gate/materialize
 *
 * Render source for gate C (闸门C · 物化): the editable prose, each Stage-3
 * draft's tasks, and the workspace's projects for the picker. 409 unless the
 * run is parked at DRAFT_READY. Scoped to the caller's workspace.
 */
export async function GET(request: Request, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { runId } = await params
  try {
    const gate = await planMaterializeService.getGateData({
      planRunId: runId,
      workspaceId: identity.workspaceId,
    })
    return NextResponse.json(gate)
  } catch (err) {
    return errorResponse(err, 'GET /api/plan-runs/[runId]/gate/materialize')
  }
}

/**
 * POST /api/plan-runs/[runId]/gate/materialize
 *
 * Confirm gate C: materialise the plan — create the Initiatives + Tasks, flip
 * consumed Ideas to PLANNED, freeze the human edit onto the GENERATE stage
 * record, and advance the run to MATERIALIZED, all in one atomic transaction
 * (design §5 / §9). Scoped to the caller's workspace.
 */
export async function POST(request: Request, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { runId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = materializePlanSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const result = await planMaterializeService.materialize({
      planRunId: runId,
      workspaceId: identity.workspaceId,
      memberId: identity.memberId,
      input: parsed.data,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'POST /api/plan-runs/[runId]/gate/materialize')
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
