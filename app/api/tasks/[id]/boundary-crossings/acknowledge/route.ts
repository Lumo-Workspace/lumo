import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { acknowledgeBoundaryCrossingSchema } from '@/lib/validation/boundary-crossing'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/tasks/[id]/boundary-crossings/acknowledge — a human acknowledges a
 * forbidden-action boundary-crossing, clearing the LUM-426 DONE block for it.
 *
 * RED LINE (mirrors the LUM-422 human-verdict route): a clearing action can
 * never come from an agent. Bearer-token identities — the agent/CLI path — are
 * refused 403 BEFORE the body is parsed; only a Clerk browser session (a human
 * at the web UI) gets through. An agent cannot acknowledge its own crossing to
 * unblock its own DONE transition.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'clerk') {
    return NextResponse.json(
      {
        error:
          'A boundary-crossing can only be acknowledged from a human-authenticated browser session — the agent/CLI path is closed by design',
      },
      { status: 403 }
    )
  }

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = acknowledgeBoundaryCrossingSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const outcome = await boundaryCrossingService.acknowledge(
      task.id,
      parsed.data.crossingId,
      {
        actorMemberId: identity.memberId,
        actorClerkId: identity.clerkId,
      }
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
