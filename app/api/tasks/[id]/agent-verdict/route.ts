import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { taskAgentVerdictService } from '@/lib/services/task-agent-verdict.service'
import { agentVerdictBodySchema } from '@/lib/validation/acceptance'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/tasks/[id]/agent-verdict — record an agent send-back of the task's
 * acceptance contract (LUM-422 ②, the third verdict channel).
 *
 * RED LINE (milestone rule 5, narrowed): no passing data row is ever
 * agent-produced. The bearer/CLI path is open here, but the body schema has no
 * verdict field at all and the service hard-codes verdict=FAIL,
 * verifierType=AGENT — PASS / PASS_WITH_FOLLOWUP are unrepresentable. Passing
 * verdicts still only enter via the human-initiated human-verdict route.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = agentVerdictBodySchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const outcome = await taskAgentVerdictService.recordAgentVerdict(
      task.id,
      parsed.data,
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
