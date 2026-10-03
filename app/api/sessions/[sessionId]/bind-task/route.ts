import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'
import { nextStepsService } from '@/lib/services/next-steps.service'
import { sessionStartEdgesService } from '@/lib/services/session-start-edges.service'
import { waitUntil } from '@vercel/functions'
import { recomputeAttributionSafely } from '@/lib/attribution/trigger'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

interface Body {
  taskIdentifier?: unknown
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { sessionId } = await context.params

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const taskIdentifier =
    typeof body.taskIdentifier === 'string' ? body.taskIdentifier.trim() : ''
  if (!taskIdentifier) {
    return NextResponse.json(
      { error: 'taskIdentifier is required (e.g. "LUM-42")' },
      { status: 400 }
    )
  }

  try {
    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId,
      taskIdentifier,
    })
    // LUM-528: the first session-start (startup) is structurally unbound, so a
    // bind-then-work-then-end session would never record lineage edges. Record
    // them here, mirroring the session-start hook. Fire-and-forget — must not
    // block or fail the bind response. `collectAndRecord` already self-catches;
    // the `.catch` guards the non-awaited promise as a belt-and-suspenders.
    waitUntil(
      sessionStartEdgesService
        .collectAndRecord({
          workspaceId: identity.workspace.id,
          taskId: result.taskId,
          sessionId,
        })
        .catch(error =>
          console.error('attach lineage edge recording error:', error)
        )
    )
    // LUM-932 P2: attaching re-scopes the family's attribution. Fail-soft.
    waitUntil(recomputeAttributionSafely(sessionId))
    const { taskStatus, ...bound } = result
    const nextSteps = await nextStepsService.forExistingTask({
      taskId: result.taskId,
      taskIdentifier: result.taskIdentifier,
      status: taskStatus,
      // Attaching is what just happened.
      sessionBound: true,
      // LUM-807: the response carries the test-case section, so the rule table
      // must not repeat it as a step.
      testCaseNudgeAlreadyShown: true,
    })
    return NextResponse.json({ ...bound, nextSteps })
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 403 || status === 404) {
      const message = error instanceof Error ? error.message : 'Error'
      return NextResponse.json({ error: message }, { status })
    }
    if (status === 409) {
      const e = error as {
        message?: string
        currentTaskIdentifier?: string
        currentTaskTitle?: string
        currentMilestoneId?: string
        currentMilestoneName?: string
      }
      return NextResponse.json(
        {
          error: e.message ?? 'Session is already bound to another task',
          currentTaskIdentifier: e.currentTaskIdentifier,
          currentTaskTitle: e.currentTaskTitle,
          // LUM-640: the steward form of the lifetime lock — the session is
          // milestone-bound, so the CLI names the milestone instead of a task.
          currentMilestoneId: e.currentMilestoneId,
          currentMilestoneName: e.currentMilestoneName,
        },
        { status: 409 }
      )
    }
    console.error('POST /api/sessions/[sessionId]/bind-task error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
