import { NextResponse } from 'next/server'
import { waitUntil } from '@/lib/runtime/wait-until'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { confirmAlignGateSchema } from '@/lib/validation/plan-run'
import { planGateService } from '@/lib/services/plan-gate.service'
import { triggerGenerateStage } from '@/lib/services/plan-generate-runner'

export const runtime = 'nodejs'

// Confirming gate B advances the run into GENERATING (Stage-3) — a slow LLM
// stage on the same order as Stages 1/2. Give it headroom over the ~60s
// platform default so it isn't killed mid-call (LUM-676).
export const maxDuration = 300

type Params = { params: Promise<{ runId: string }> }

/**
 * GET /api/plan-runs/[runId]/gate/align
 *
 * Render source for gate B (闸门B · 对齐确认): the ALIGN stage's per-cluster
 * verdicts (three-way judgment + customization-trap flag + one-line rationale).
 * 409 unless the run is parked at ALIGNMENT_READY with an ALIGN record.
 */
export async function GET(
  request: Request,
  { params }: Params
): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { runId } = await params
  try {
    const gate = await planGateService.getAlignGate(runId)
    return NextResponse.json(gate)
  } catch (err) {
    return errorResponse(err, 'GET /api/plan-runs/[runId]/gate/align')
  }
}

/**
 * POST /api/plan-runs/[runId]/gate/align
 *
 * Confirm gate B: freeze the human's verdict switches + star selections onto
 * the ALIGN stage record's `humanConfirmedOutput`, advance the run to
 * GENERATING, and hand the ≤2 starred ALIGNED clusters to Stage 3. Returns the
 * updated run and the selected clusterIds.
 *
 * Stage 3 (成计划) is then kicked off out of band via `waitUntil` — fail-soft,
 * mirroring gate A → `triggerAlignStage`. It never blocks or fails this
 * confirm, which has already been persisted (LUM-689).
 */
export async function POST(
  request: Request,
  { params }: Params
): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { runId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = confirmAlignGateSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const result = await planGateService.confirmAlignGate({
      planRunId: runId,
      memberId: identity.memberId,
      input: parsed.data,
    })
    waitUntil(triggerGenerateStage(result.run.id))
    return NextResponse.json(result)
  } catch (err) {
    return errorResponse(err, 'POST /api/plan-runs/[runId]/gate/align')
  }
}

function errorResponse(err: unknown, tag: string): NextResponse {
  const errStatus = (err as { status?: unknown } | null)?.status
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
