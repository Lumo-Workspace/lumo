import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { resolveCrossingParam } from '@/lib/api/resolve-crossing-param'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; crossingId: string }> }

/**
 * POST /api/tasks/[id]/boundary-crossings/[crossingId]/remediation — spawn a
 * remediation follow-up task from a crossing (LUM-435): creates a pre-linked
 * TODO task and a dependency edge (remediation blocked-by the original task).
 *
 * This is a NORMAL authenticated write, NOT the human-only disposition redline:
 * spawning a task is ordinary task creation (it does not clear the DONE gate),
 * so any authenticated identity (human or, via a human-reviewed action, agent)
 * may call it. The gate-clearing disposition stays human-only on its own route.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId, crossingId: rawCrossingId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  // LUM-1059: accept the `<TEAM>-X<n>` ref; resolve to the cuid first.
  const crossingId = await resolveCrossingParam(rawCrossingId, task.id)

  try {
    const outcome = await boundaryCrossingService.spawnRemediation(
      task.id,
      crossingId,
      {
        actorMemberId: identity.memberId,
        actorClerkId: identity.clerkId,
        workspaceId: identity.workspaceId,
      }
    )
    return NextResponse.json(outcome, { status: 201 })
  } catch (error) {
    const maybeStatus = (error as { status?: unknown } | null)?.status
    const status = typeof maybeStatus === 'number' ? maybeStatus : 500
    const message =
      status === 500 || !(error instanceof Error)
        ? 'Internal Server Error'
        : error.message
    return NextResponse.json({ error: message }, { status })
  }
}
