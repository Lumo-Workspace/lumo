import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { taskDecisionSchema } from '@/lib/validation/task-template'
import { taskDecisionService } from '@/lib/services/task-decision.service'

/**
 * POST /api/tasks/by-identifier/[identifier]/decisions
 *
 * Bearer-authed CLI endpoint for `lumo task decide` (LUM-970): appends one
 * ruling to the description's `## Decisions` section, creating it if absent.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ identifier: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) {
    return NextResponse.json(
      { error: 'Invalid or revoked API key' },
      { status: 401 }
    )
  }
  const { identifier } = await context.params

  const body = await request.json().catch(() => null)
  const parsed = taskDecisionSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const task = await taskDecisionService.appendToTask({
      workspaceId: identity.workspace.id,
      workspaceSlug: identity.workspace.slug,
      callerClerkId: identity.user.id,
      identifier,
      text: parsed.data.text,
      sourceSessionId: request.headers.get('x-lumo-session-id'),
    })
    return NextResponse.json({
      task: { identifier: task.identifier, title: task.title, url: task.url },
    })
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[POST /api/tasks/by-identifier/[identifier]/decisions]'
    )
  }
}
