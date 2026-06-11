import { NextResponse, type NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { mentionStatusService } from '@/lib/services/mention-status.service'

/** Cap on identifiers resolved per request — a doc with more task mentions than
 *  this is pathological; the render side batches the rest in a follow-up call. */
const MAX_IDS = 200

/**
 * Batch live-status lookup for task-mention chips (LUM-411). Given `?ids=` a
 * comma-separated list of `TEAM-N` identifiers, returns each visible task's
 * current status + PR state. Session-authed and workspace-scoped (identity
 * resolves the caller's workspace); unknown / out-of-workspace identifiers are
 * simply absent from the response.
 */
export async function GET(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { workspaceId } = identity

    const raw = new URL(request.url).searchParams.get('ids') ?? ''
    const ids = raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, MAX_IDS)

    const items = await mentionStatusService.resolve(workspaceId, ids)
    return NextResponse.json({ items })
  } catch (error) {
    console.error('GET /api/workspaces/mention-status error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
