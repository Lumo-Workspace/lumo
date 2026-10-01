import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { cliUpdateTaskSchema } from '@/lib/validation/schemas'
import { taskCliService } from '@/lib/services/task-cli.service'
import { nextStepsService } from '@/lib/services/next-steps.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

/**
 * GET /api/tasks/by-identifier/[identifier]
 *
 * Bearer-authed CLI endpoint for `lumo task show`. Returns a CLI-shaped view
 * of the task: identifier, title, status, priority, description, project,
 * assignee (with member name/email resolved from Clerk), and URL. Web
 * callers should use GET /api/tasks/[id] (richer payload, Clerk auth).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ identifier: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { identifier } = await context.params

  try {
    const task = await taskCliService.showFromCli({
      workspaceId: identity.workspace.id,
      workspaceSlug: identity.workspace.slug,
      identifier,
    })
    return NextResponse.json({ task })
  } catch (err) {
    const errStatus = (err as { status?: unknown })?.status
    const status = typeof errStatus === 'number' ? errStatus : 500
    const message =
      status === 500
        ? 'Internal Server Error'
        : err instanceof Error
          ? err.message
          : 'Error'
    if (status === 500) {
      console.error('GET /api/tasks/by-identifier error:', err)
    }
    return NextResponse.json({ error: message }, { status })
  }
}

/**
 * PATCH /api/tasks/by-identifier/[identifier]
 *
 * Bearer-authed CLI endpoint for `lumo task update`. Accepts human-friendly
 * refs (member email/name for `assigneeRef`) and resolves them server-side.
 * Web callers use PATCH /api/tasks/[id] instead.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ identifier: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { identifier } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = cliUpdateTaskSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }

  // At-least-one-field guard. Friendlier than letting the update no-op.
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json(
      { error: 'Provide at least one field to update' },
      { status: 400 }
    )
  }

  try {
    const task = await taskCliService.updateFromCli({
      workspaceId: identity.workspace.id,
      workspaceSlug: identity.workspace.slug,
      callerClerkId: identity.user.id,
      identifier,
      // CC session driving this update; attributes a DONE→Layer2 promotion to
      // the session so the next session-start can review it (LUM-165).
      sourceSessionId: request.headers.get('x-lumo-session-id'),
      input: parsed.data,
    })
    // Compose: the update service reports the new status, nextStepsService
    // reads the acceptance state. Keeping the reads here leaves the write path
    // free of them (LUM-686).
    const { status: newStatus, ...taskPayload } = task
    const nextSteps = await nextStepsService.forExistingTask({
      taskId: task.id,
      taskIdentifier: task.identifier,
      status: newStatus,
      sessionBound: request.headers.get('X-Lumo-Session-Id') != null,
      criteriaNudgeAlreadyShown: false,
    })
    return NextResponse.json({ task: taskPayload, nextSteps }, { status: 200 })
  } catch (err) {
    const errStatus = (err as { status?: unknown })?.status
    const status = typeof errStatus === 'number' ? errStatus : 500
    const message =
      status === 500
        ? 'Internal Server Error'
        : err instanceof Error
          ? err.message
          : 'Error'
    if (status === 500) {
      console.error('PATCH /api/tasks/by-identifier error:', err)
    }
    return NextResponse.json({ error: message }, { status })
  }
}

/**
 * DELETE /api/tasks/by-identifier/[identifier]
 *
 * Bearer-authed CLI endpoint for `lumo task delete` (LUM-821). Moves the
 * task to the trash (LUM-918), same as the web's DELETE /api/tasks/[id]; the
 * CLI only sends it after the user approved the confirmation envelope.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ identifier: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { identifier } = await context.params

  try {
    const deleted = await taskCliService.deleteFromCli({
      workspaceId: identity.workspace.id,
      identifier,
      clerkId: identity.user.id,
    })
    return NextResponse.json({ deleted })
  } catch (err) {
    const errStatus = (err as { status?: unknown })?.status
    const status = typeof errStatus === 'number' ? errStatus : 500
    const message =
      status === 500
        ? 'Internal Server Error'
        : err instanceof Error
          ? err.message
          : 'Error'
    if (status === 500) {
      console.error('DELETE /api/tasks/by-identifier error:', err)
    }
    return NextResponse.json({ error: message }, { status })
  }
}
