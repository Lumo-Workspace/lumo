import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

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
    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 403 || status === 404) {
      const message = error instanceof Error ? error.message : 'Error'
      return NextResponse.json({ error: message }, { status })
    }
    console.error('POST /api/sessions/[sessionId]/bind-task error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/sessions/[sessionId]/bind-task
 *
 * Detach the session from its current task. Ownership-scoped: 404 if the
 * session doesn't exist or belongs to another member (no enumeration).
 *
 * Idempotent — re-detaching returns 200 with `alreadyUnbound: true`.
 * Existing HookEvent rows are not retagged; only future events get
 * `taskId: null`.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { sessionId } = await context.params

  const result = await sessionService.unbindSession({ identity, sessionId })
  if (!result.found) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  return NextResponse.json(result)
}
