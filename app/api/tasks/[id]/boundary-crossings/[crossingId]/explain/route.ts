import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { explainBoundaryCrossingSchema } from '@/lib/validation/boundary-crossing'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; crossingId: string }> }

/**
 * POST /api/tasks/[id]/boundary-crossings/[crossingId]/explain — an agent
 * appends an append-only self-explanation ("申辩") to a boundary crossing
 * (LUM-542).
 *
 * RED LINE — the deliberate INVERSE of the disposition route: where
 * dispositioning is human-only (a Clerk browser session, bearer refused before
 * parse), explaining is the AGENT path. A Clerk (human/browser) identity is
 * refused 403 BEFORE the body is parsed; only a bearer (agent/CLI) caller gets
 * through. But this path can ONLY append a note — it has no disposition write
 * code at all (the schema can't even carry one), so an agent still cannot clear
 * its own crossing or unblock its own DONE gate. The service additionally scopes
 * the write to the crossing's task and the caller session's binding.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'bearer') {
    return NextResponse.json(
      {
        error:
          'A boundary-crossing explanation can only be recorded by the agent/CLI (bearer) path — a human reviewer dispositions, they do not file the agent self-report',
      },
      { status: 403 }
    )
  }

  const { id: rawId, crossingId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = explainBoundaryCrossingSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  // Attribution comes from the hook headers the CLI already sends (LUM-469);
  // both optional — the service falls back to task/workspace scope when absent.
  const authorSessionId = request.headers.get('X-Lumo-Session-Id')
  const authorAgent = request.headers.get('X-Lumo-Agent')

  try {
    const outcome = await boundaryCrossingService.explain(
      task.id,
      crossingId,
      parsed.data.note,
      { authorSessionId, authorAgent, memberId: identity.memberId }
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
