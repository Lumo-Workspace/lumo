import { NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

// Keep in sync with the LineageFragmentType enum in prisma/schema.prisma.
const FRAGMENT_TYPES = [
  'MEMORY',
  'SLACK_CONTEXT',
  'WEB_LINK',
  'FIGMA',
  'PR',
  'PR_REVIEW_TODO',
  'SESSION',
] as const

const bodySchema = z.object({
  usedRefs: z
    .array(
      z.object({
        fragmentType: z.enum(FRAGMENT_TYPES),
        fragmentId: z.string(),
      })
    )
    .max(200),
})

/**
 * GET /api/sessions/[sessionId]/fragment-usage
 *
 * Draft for the wrap usage-vote step (LUM-300): the context fragments this
 * session consumed, so the agent can mark which it actually used. Bearer-only,
 * member-scoped; empty payload if the session is missing / not owned.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { sessionId } = await context.params
  try {
    const result = await sessionService.getFragmentUsageDraft({
      identity,
      sessionId,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('GET /api/sessions/[sessionId]/fragment-usage error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * POST /api/sessions/[sessionId]/fragment-usage
 *
 * Apply an agent usage vote: stamp used=true/false on this session's lineage
 * edges. Bearer-only, member-scoped; the service no-ops a missing/unowned
 * session so it can't touch other sessions' edges.
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
    const result = await sessionService.applyFragmentUsage({
      identity,
      sessionId,
      usedRefs: parsed.data.usedRefs,
    })
    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 404 || status === 409 || status === 500) {
      const message = error instanceof Error ? error.message : 'Error'
      return NextResponse.json({ error: message }, { status })
    }
    console.error('POST /api/sessions/[sessionId]/fragment-usage error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
