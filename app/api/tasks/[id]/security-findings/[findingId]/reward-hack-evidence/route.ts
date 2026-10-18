import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { rewardHackEvidenceService } from '@/ee/security/services/reward-hack-evidence.service'
import { rewardHackEvidenceParamsSchema } from '@/ee/security/validation/security-scan'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; findingId: string }> }

/**
 * GET /api/tasks/[id]/security-findings/[findingId]/reward-hack-evidence —
 * the evidence behind one REWARD_HACK finding for the task's security panel
 * (LUM-1234): summary, requirement excerpt, and the cited session prompts
 * and steps the viewer may open (else `restricted`).
 *
 * Browser session only: session text never goes to an API-key caller (an
 * agent's terminal), which gets 403. A finding that is not REWARD_HACK, is
 * on another task, or whose workspace the viewer is not a member of is a
 * 404 — the same answer as a missing id, so ids can't be probed.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  if (identity.source !== 'clerk') {
    return NextResponse.json(
      { error: 'Reward-hack evidence is web-only' },
      { status: 403 }
    )
  }

  const parsed = rewardHackEvidenceParamsSchema.safeParse(await params)
  if (!parsed.success) return zodError(parsed)

  try {
    const task = await resolveTaskParam(parsed.data.id, identity.workspaceId)
    if (!task)
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    const view = await rewardHackEvidenceService.getForViewer(
      parsed.data.findingId,
      identity.clerkId,
      { taskId: task.id }
    )
    if (!view)
      return NextResponse.json({ error: 'Finding not found' }, { status: 404 })
    return NextResponse.json(view, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[GET /api/tasks/[id]/security-findings/[findingId]/reward-hack-evidence]'
    )
  }
}
