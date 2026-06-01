import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

/**
 * GET /api/sessions/[sessionId]/turn-summaries
 *
 * Returns the unposted progress draft for `lumo session wrap`: the session's
 * bound task plus every turnSummary written since the last progress comment.
 * Bearer-only, member-scoped (a session that doesn't exist / isn't owned
 * yields an empty payload, never an enumeration signal).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { sessionId } = await context.params
  const result = await sessionService.getSessionProgressDraft({
    identity,
    sessionId,
  })
  return NextResponse.json(result)
}
