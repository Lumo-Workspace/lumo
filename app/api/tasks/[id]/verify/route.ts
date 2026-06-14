import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { taskVerificationService } from '@/lib/services/task-verification.service'
import { enforceSessionBinding } from '@/lib/services/session-binding-guard'
import { machineRoundBodySchema } from '@/lib/validation/acceptance'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/tasks/[id]/verify — record one machine verification round.
 *
 * The agent's CLI executed every MACHINE checkpointer locally and reports
 * structured verdicts; the judge (round numbering, cap, escalation, the
 * IN_REVIEW transition) lives server-side in taskVerificationService.
 *
 * RED LINE (milestone rule 5): this is the only agent/CLI-reachable
 * VerificationRun write path and it can only produce MACHINE rows — the body
 * schema is strict with no verifierType field, and the service hard-codes
 * MACHINE on write. Human verdicts enter exclusively through human-initiated
 * paths (web UI / Slack action, Slice 2), never through here.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = machineRoundBodySchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const { advisory } = await enforceSessionBinding({
      source: identity.source,
      sessionId: request.headers.get('X-Lumo-Session-Id'),
      memberId: identity.memberId,
      targetTaskId: task.id,
      action: 'machine verification',
    })
    const outcome = await taskVerificationService.recordMachineRound(
      task.id,
      identity.workspaceId,
      parsed.data.results,
      {
        actorMemberId: identity.memberId,
        actorClerkId: identity.clerkId,
        sourceSessionId: request.headers.get('X-Lumo-Session-Id'),
      }
    )
    return NextResponse.json({ ...outcome, bindingAdvisory: advisory })
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
