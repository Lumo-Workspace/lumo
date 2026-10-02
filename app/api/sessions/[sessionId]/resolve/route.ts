import { NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionResolveService } from '@/lib/services/session-resolve.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }
const Body = z.object({ argv: z.array(z.string().max(4000)).max(200) })

/**
 * POST /api/sessions/[sessionId]/resolve — LUM-932. The CLI sends its own
 * argv; the response names the session (parent or a subagent's child) that
 * issued the call, so subagent commands act on the subagent's own session.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })
  const { sessionId } = await context.params
  let parsed: z.infer<typeof Body>
  try {
    parsed = Body.parse(await request.json())
  } catch {
    return NextResponse.json(
      { error: 'argv must be an array of strings' },
      { status: 400 }
    )
  }
  try {
    const result = await sessionResolveService.resolveCaller({
      identity,
      sessionId,
      argv: parsed.argv,
    })
    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 403) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 403 }
      )
    }
    console.error('POST /api/sessions/[sessionId]/resolve error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
