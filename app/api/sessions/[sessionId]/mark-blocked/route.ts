import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

/**
 * POST /api/sessions/[sessionId]/mark-blocked
 *
 * Attach the `blocked` tag to the session's bound task (LUM-153). Invoked only
 * after the wrap-panel prompt is confirmed — never automatically. Idempotent.
 * Bearer-only, member-scoped. 409 when the session has no bound task; 404 when
 * the session is missing / not owned. No request body.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { sessionId } = await context.params

  try {
    const result = await sessionService.markBoundTaskBlocked({
      identity,
      sessionId,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 404 || status === 409 || status === 500) {
      const message = error instanceof Error ? error.message : 'Error'
      return NextResponse.json({ error: message }, { status })
    }
    console.error('POST /api/sessions/[sessionId]/mark-blocked error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
