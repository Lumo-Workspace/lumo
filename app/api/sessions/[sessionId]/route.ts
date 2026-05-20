import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

/**
 * GET /api/sessions/[sessionId]
 *
 * Returns the binding state for the given session, scoped to the bearer's
 * workspace member. Sessions that don't exist or belong to another member
 * both return 404 — the caller cannot distinguish (no enumeration).
 *
 * Used by `lumo session status` to tell the user which task the current
 * Claude Code session is bound to.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { sessionId } = await context.params

  const result = await sessionService.getSessionStatus({ identity, sessionId })
  if (!result.exists) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  return NextResponse.json(result)
}
