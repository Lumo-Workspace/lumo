import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { createTaskDecisionSchema } from '@/lib/validation/task-decision'
import { taskDecisionService } from '@/lib/services/task-decision.service'

/**
 * POST /api/tasks/by-identifier/[identifier]/decisions
 *
 * Bearer-authed CLI endpoint for `lumo task decide` (LUM-970): records one
 * ruling (with an optional rationale) on the task's Decisions tab (LUM-1303).
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
  const parsed = createTaskDecisionSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const { task, decision } = await taskDecisionService.recordFromCli({
      workspaceId: identity.workspace.id,
      workspaceSlug: identity.workspace.slug,
      callerClerkId: identity.user.id,
      identifier,
      text: parsed.data.text,
      rationale: parsed.data.rationale,
      sourceSessionId: request.headers.get('x-lumo-session-id'),
    })
    return NextResponse.json({ task, decision }, { status: 201 })
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[POST /api/tasks/by-identifier/[identifier]/decisions]'
    )
  }
}
