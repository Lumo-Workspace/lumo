import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { cliCreateTaskSchema } from '@/lib/validation/schemas'
import { taskCliService } from '@/lib/services/task-cli.service'
import { miscRepository } from '@/lib/repositories/misc.repository'

// LUM-1286: the duplicate gate may wait up to 45s on the LLM before creating.
export const maxDuration = 60

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

  const memberId = await miscRepository.findMemberIdForHook(
    identity.user.id,
    identity.workspace.id
  )
  const sessionId = request.headers.get('X-Lumo-Session-Id')

  try {
    const { nextSteps, warnings, ...task } = await taskCliService.createFromCli(
      {
        workspaceId: identity.workspace.id,
        workspaceSlug: identity.workspace.slug,
        callerClerkId: identity.user.id,
        memberId,
        sessionId,
        input: parsed.data,
      }
    )
    // nextSteps rides alongside `task`, not inside it — the task payload shape
    // is consumed elsewhere and must not grow a presentation field (LUM-686).
    // LUM-1285: `warnings` rides alongside too (e.g. the project is paused).
    return NextResponse.json({ task, nextSteps, warnings }, { status: 201 })
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
      console.error('POST /api/tasks error:', err)
    }
    // LUM-1286: the duplicate gate's candidates ride along so the CLI can
    // render its confirmation envelope.
    const { code, duplicates } = (err ?? {}) as {
      code?: unknown
      duplicates?: unknown
    }
    if (code === 'POSSIBLE_DUPLICATES' && Array.isArray(duplicates)) {
      return NextResponse.json({ error: message, code, duplicates }, { status })
    }
    return NextResponse.json({ error: message }, { status })
  }
}
