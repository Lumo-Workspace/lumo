import { NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

const bodySchema = z.object({
  watermark: z.string().datetime(),
  deleteIds: z.array(z.string()).max(200).default([]),
  promoteIds: z.array(z.string()).max(200).default([]),
})

/**
 * POST /api/sessions/[sessionId]/memory-review
 *
 * Apply a wrap memory review: delete and/or promote the chosen memories and
 * advance the dedup watermark in one call. Bearer-only, member-scoped; the
 * service drops any id not sedimented by this session. 404 if the session is
 * missing / not owned.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { sessionId } = await context.params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid body' },
      { status: 400 }
    )
  }

  try {
    const result = await sessionService.applyMemoryReview({
      identity,
      sessionId,
      watermark: parsed.data.watermark,
      deleteIds: parsed.data.deleteIds,
      promoteIds: parsed.data.promoteIds,
    })
    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 404 || status === 409 || status === 500) {
      const message = error instanceof Error ? error.message : 'Error'
      return NextResponse.json({ error: message }, { status })
    }
    console.error('POST /api/sessions/[sessionId]/memory-review error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
