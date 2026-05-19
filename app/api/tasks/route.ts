import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { cliCreateTaskSchema } from '@/lib/validation/schemas'
import { taskCliService } from '@/lib/services/task-cli.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

/**
 * POST /api/tasks
 *
 * Bearer-authed CLI endpoint for `lumo task create`. Accepts human-friendly
 * refs (project name/slug, member email/name) and returns the created
 * task's identifier + URL. Web callers use POST /api/projects/[id]/tasks
 * instead.
 */
export async function POST(request: Request): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = cliCreateTaskSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }

  try {
    const task = await taskCliService.createFromCli({
      workspaceId: identity.workspace.id,
      workspaceSlug: identity.workspace.slug,
      callerClerkId: identity.user.id,
      input: parsed.data,
    })
    return NextResponse.json({ task }, { status: 201 })
  } catch (err) {
    const status =
      err instanceof Error && 'status' in err
        ? (err as Error & { status: number }).status
        : 500
    const message =
      status === 500 ? 'Internal Server Error' : (err as Error).message
    if (status === 500) {
      console.error('POST /api/tasks error:', err)
    }
    return NextResponse.json({ error: message }, { status })
  }
}
