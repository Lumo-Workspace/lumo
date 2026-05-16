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
