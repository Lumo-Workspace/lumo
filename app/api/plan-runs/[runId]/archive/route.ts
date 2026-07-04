import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { planRunService } from '@/lib/services'

export const runtime = 'nodejs'

type Params = { params: Promise<{ runId: string }> }

/**
 * GET /api/plan-runs/[runId]/archive
 *
 * A run's read-only archive (LUM-677): the run + each gate's stage record
 * (llmRawOutput vs humanConfirmedOutput = the "全量存档") + the materialized
 * Initiative(s) for lineage. Workspace-scoped — a run in another workspace is
 * reported as 404 so the endpoint never confirms a foreign run's existence.
 */
export async function GET(request: Request, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { runId } = await params
  try {
    const archive = await planRunService.getArchive({
      runId,
      workspaceId: identity.workspaceId,
    })
    return NextResponse.json(archive)
  } catch (err) {
    return errorResponse(err, 'GET /api/plan-runs/[runId]/archive')
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
