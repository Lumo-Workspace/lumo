import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { resolveCrossingParam } from '@/lib/api/resolve-crossing-param'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; crossingId: string }> }

/**
 * POST /api/tasks/[id]/boundary-crossings/[crossingId]/system-explain —
 * Generate (or return cached) a SYSTEM plain-language explanation for a
 * boundary crossing (LUM-590).
 *
 * RED LINE (mirrors the disposition route): a SYSTEM explanation can only be
 * requested by a human at the web UI — keeping it a human affordance, symmetric
 * with how disposition is human-only. Bearer/agent identities are refused 403
 * BEFORE the body is parsed. An agent cannot trigger system-explanation
 * generation (it has its own append-only "申辩" path via the `explain` route).
 *
 * ADVISORY ONLY: this endpoint has zero effect on disposition or the DONE gate.
 * The generated text is advisory, hedged, and explicitly non-binding.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  // Human/Clerk only — same guard as the disposition route.
  if (identity.source !== 'clerk') {
    return NextResponse.json(
      {
        error:
          'A boundary-crossing system explanation can only be requested from a human-authenticated browser session — the agent/CLI path is closed by design',
      },
      { status: 403 }
    )
  }

  const { id: rawId, crossingId: rawCrossingId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  // LUM-1059: accept the `<TEAM>-X<n>` ref; resolve to the cuid first.
  const crossingId = await resolveCrossingParam(rawCrossingId, task.id)

  try {
    const result = await boundaryCrossingService.explainCrossing(
      task.id,
      crossingId
    )
    return NextResponse.json(result)
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
