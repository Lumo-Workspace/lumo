import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

/**
 * GET /api/sessions/[sessionId]/failure-summary
 *
 * Draft for the `lumo session wrap` blocked-tag prompt (LUM-153): reports
 * whether the same kind of tool/turn failure recurred ≥ threshold times this
 * session on the bound task (and whether it's already blocked). Read-only —
 * never mutates. Bearer-only, member-scoped. Returns `shouldPrompt: false`
 * (200) rather than erroring when there's nothing to prompt about.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { sessionId } = await context.params

  try {
    const result = await sessionService.getSessionFailureDraft({
      identity,
      sessionId,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error(
      'GET /api/sessions/[sessionId]/failure-summary error:',
      error
    )
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
