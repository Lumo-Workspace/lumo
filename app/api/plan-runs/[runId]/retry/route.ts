import { NextResponse } from 'next/server'
import { waitUntil } from '@/lib/runtime/wait-until'
import { requireIdentity } from '@/lib/auth'
import { planRunService } from '@/lib/services/plan-run.service'
import { triggerClusterStage } from '@/lib/services/plan-cluster-runner'
import { triggerAlignStage } from '@/lib/services/plan-align-runner'
import { triggerGenerateStage } from '@/lib/services/plan-generate-runner'
import type { PlanStageKind } from '@prisma/client'

export const runtime = 'nodejs'

// A retry re-runs a full LLM segment, same order as the original. Give it the
// same headroom the gate routes get so it isn't killed mid-call (LUM-676).
export const maxDuration = 300

type Params = { params: Promise<{ runId: string }> }

const RUNNER_BY_KIND: Record<PlanStageKind, (runId: string) => Promise<void>> =
  {
    CLUSTER: triggerClusterStage,
    ALIGN: triggerAlignStage,
    GENERATE: triggerGenerateStage,
  }

/**
 * POST /api/plan-runs/[runId]/retry
 *
 * Re-dispatch the LLM segment a stuck run is sitting in — the user-facing way
 * out of "Working on the plan…" (LUM-689). Covers both wedge shapes: a run
 * parked on a working stage whose runner never ran (every gate-B-confirmed run
 * before Stage 3 was wired), and a FAILED run whose segment is recovered from
 * its stage records.
 *
 * The re-run itself goes out of band via `waitUntil` — the response reports
 * only that the retry was accepted and which stage is now running.
 *
 * 404 run not found / another workspace · 409 the run is parked at an open gate
 * or is terminal (nothing to re-run).
 */
export async function POST(request: Request, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { runId } = await params

  try {
    const { run, kind } = await planRunService.retryStage({
      planRunId: runId,
      workspaceId: identity.workspaceId,
    })
    waitUntil(RUNNER_BY_KIND[kind](run.id))
    return NextResponse.json({ run: { id: run.id, stage: run.stage }, kind })
  } catch (err) {
    const errStatus = (err as { status?: unknown } | null)?.status
    const status = typeof errStatus === 'number' ? errStatus : 500
    if (status === 500) {
      console.error('POST /api/plan-runs/[runId]/retry error:', err)
      return NextResponse.json(
        { error: 'Internal Server Error' },
        { status: 500 }
      )
    }
    const message = err instanceof Error ? err.message : 'Error'
    return NextResponse.json({ error: message }, { status })
  }
}
