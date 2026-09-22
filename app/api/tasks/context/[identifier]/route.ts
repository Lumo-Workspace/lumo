import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { taskContextService } from '@/lib/services/task-context.service'
import { nextStepsService } from '@/lib/services/next-steps.service'
import type { TaskStatusForNextSteps } from '@/lib/context/render/next-steps'

export async function GET(
  request: Request,
  context: { params: Promise<{ identifier: string }> }
): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { identifier } = await context.params
  const result = await taskContextService.getContextForIdentifier(
    identity.workspaceId,
    identity.memberId,
    identifier
  )
  if (!result) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
  // LUM-686: the payload already carries `criteriaSection` (contract or draft
  // nudge), so the rule table must not restate that advice. `sessionBound` is
  // false here — reading context says nothing about this session's binding, and
  // suggesting attach when it may already be bound is the one hint that would
  // send the agent into a 409.
  const nextSteps = await nextStepsService.forExistingTask({
    taskId: result.task.id,
    taskIdentifier: result.task.identifier,
    status: result.task.status as TaskStatusForNextSteps,
    sessionBound: true,
    criteriaNudgeAlreadyShown: true,
    // LUM-807: ditto for the test-case nudge the payload already carries.
    testCaseNudgeAlreadyShown: true,
  })
  return NextResponse.json({ ...result, nextSteps })
}
