import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { cliUpdateTaskSchema } from '@/lib/validation/schemas'
import { taskCliService } from '@/lib/services/task-cli.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

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
      input: parsed.data,
    })
    return NextResponse.json({ task }, { status: 200 })
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
