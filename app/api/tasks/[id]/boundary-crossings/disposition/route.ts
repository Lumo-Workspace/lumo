import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { dispositionBoundaryCrossingSchema } from '@/lib/validation/boundary-crossing'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/tasks/[id]/boundary-crossings/disposition — a human dispositions a
 * forbidden-action boundary-crossing as FALSE_POSITIVE or CONFIRMED (LUM-435),
 * clearing the DONE block for it. The note is optional.
 *
 * RED LINE (mirrors the LUM-422 human-verdict / LUM-426 acknowledge routes): a
 * clearing action can never come from an agent. Bearer-token identities — the
 * agent/CLI path — are refused 403 BEFORE the body is parsed; only a Clerk
 * browser session (a human at the web UI) gets through. An agent can never
 * disposition its own crossing to unblock its own DONE transition.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'clerk') {
    return NextResponse.json(
      {
        error:
          'A boundary-crossing can only be dispositioned from a human-authenticated browser session — the agent/CLI path is closed by design',
      },
      { status: 403 }
    )
  }

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = dispositionBoundaryCrossingSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  // The OPEN sentinel (LUM-450) reverts a crossing back to undispositioned —
  // mapped to a null disposition for the service, which re-blocks the gate.
  const target =
    parsed.data.disposition === 'OPEN' ? null : parsed.data.disposition

  try {
    const outcome = await boundaryCrossingService.disposition(
      task.id,
      parsed.data.crossingId,
      target,
      parsed.data.dispositionNote ?? null,
      {
        actorMemberId: identity.memberId,
        actorClerkId: identity.clerkId,
      },
      // LUM-751: per-repository suppression opt-in (FALSE_POSITIVE only) —
      // passed only when requested, so the plain call shape is unchanged.
      ...(parsed.data.suppressSimilarInProject
        ? [
            {
              suppressSimilarInProject: true,
              suppressionReason: parsed.data.suppressionReason ?? null,
              suppressionScope: parsed.data.suppressionScope ?? 'exact',
            },
          ]
        : [])
    )
    return NextResponse.json(outcome)
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
