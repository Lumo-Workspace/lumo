import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { planRunService } from '@/lib/services'

export const runtime = 'nodejs'

/**
 * GET /api/plan-runs/latest-clustering
 *
 * The clustering the Ideas page groups its pool by (LUM-677): the CLUSTER
 * output of the caller team's most recent run to reach CLUSTERS_READY (the
 * human-confirmed edit if the gate was confirmed, else the raw Stage-1 output),
 * or `{ clustering: null }` when no run has clustered yet. A pure read of
 * stored records — no clustering LLM call is made.
 */
export async function GET(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  try {
    const clustering = await planRunService.getLatestClustering({
      workspaceId: identity.workspaceId,
    })
    return NextResponse.json({ clustering })
  } catch (err) {
    return errorResponse(err, 'GET /api/plan-runs/latest-clustering')
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
