import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; ruleId: string }> }

/**
 * DELETE /api/tasks/[id]/boundary-crossings/suppression-rules/[ruleId] —
 * a human soft-revokes a repository suppression rule (LUM-751): future
 * occurrences of that (category, target) shape are recorded OPEN again. The
 * row is kept for audit — nothing is deleted.
 *
 * RED LINE (mirrors the disposition route): a rule governs which crossings
 * clear the DONE gate on their own, so creating or revoking one is a human
 * decision. Bearer-token identities — the agent/CLI path — are refused 403
 * BEFORE anything is read; only a Clerk browser session gets through.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'clerk') {
    return NextResponse.json(
      {
        error:
          'A suppression rule can only be revoked from a human-authenticated browser session — the agent/CLI path is closed by design',
      },
      { status: 403 }
    )
  }

  const { id: rawId, ruleId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  try {
    const outcome = await boundaryCrossingService.revokeSuppressionRule(
      task.id,
      ruleId,
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
