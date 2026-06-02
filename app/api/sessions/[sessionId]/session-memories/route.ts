import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

/**
 * GET /api/sessions/[sessionId]/session-memories
 *
 * Returns the memory-review draft for `lumo session wrap`: the Layer1 memories
 * this session sedimented since the last review. Bearer-only, member-scoped (a
 * session that doesn't exist / isn't owned yields an empty payload).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { sessionId } = await context.params
  try {
    const result = await sessionService.getSessionMemoryDraft({
      identity,
      sessionId,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('GET /api/sessions/[sessionId]/session-memories error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
