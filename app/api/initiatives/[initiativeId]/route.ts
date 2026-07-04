import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { initiativeService } from '@/lib/services/initiative.service'

interface Params {
  params: Promise<{ initiativeId: string }>
}

/**
 * GET /api/initiatives/[initiativeId]
 *
 * One initiative with its lineage — the consumed Ideas and the attached Tasks.
 * Scoped to the caller's team: an id belonging to another team returns 404
 * (same as a genuinely missing row), so the boundary can't be probed.
 */
export async function GET(
  request: NextRequest,
  { params }: Params
): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  try {
    const { initiativeId } = await params
    const initiative = await initiativeService.getDetail({
      workspaceId: identity.workspaceId,
      initiativeId,
    })
    return NextResponse.json({ initiative })
  } catch (err) {
    return errorResponse(err, 'GET /api/initiatives/[initiativeId]')
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
