import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { planMaterializeService } from '@/lib/services'

export const runtime = 'nodejs'

type Params = { params: Promise<{ runId: string }> }

/**
 * GET /api/plan-runs/[runId]
 *
 * Thin run read (id + stage) for the deep-link gate dispatcher — the web page
 * picks which gate board to render from the stage. Scoped to the caller's
 * workspace.
 */
export async function GET(request: Request, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { runId } = await params
  try {
    const run = await planMaterializeService.getRunView({
      planRunId: runId,
      workspaceId: identity.workspaceId,
    })
    return NextResponse.json(run)
  } catch (err) {
    return errorResponse(err, 'GET /api/plan-runs/[runId]')
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
