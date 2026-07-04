import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { captureIdeaSchema } from '@/lib/validation/idea'
import { ideaService } from '@/lib/services'

/**
 * POST /api/ideas
 *
 * Capture a team-level idea into the pool. Auth via Clerk (web) or Bearer
 * (CLI — `lumo idea`). The idea is attributed to the authenticated member and
 * scoped to the workspace's default team; a team-scoped `number` is assigned
 * and the created idea (with its `<TEAM>-I<n>` identifier) is returned.
 */
export async function POST(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = captureIdeaSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const idea = await ideaService.capture({
      workspaceId: identity.workspaceId,
      memberId: identity.memberId,
      input: parsed.data,
    })
    return NextResponse.json({ idea }, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'POST /api/ideas')
  }
}

/**
 * GET /api/ideas
 *
 * The caller team's unprocessed (CAPTURED) pool — the read the transformer
 * (Spec 2) consumes. Scoped to the caller's default team; never leaks another
 * team's ideas.
 */
export async function GET(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  try {
    const ideas = await ideaService.listUnprocessed({
      workspaceId: identity.workspaceId,
    })
    return NextResponse.json({ ideas })
  } catch (err) {
    return errorResponse(err, 'GET /api/ideas')
  }
}

function errorResponse(err: unknown, tag: string): NextResponse {
  const errStatus = (err as { status?: unknown })?.status
  const status = typeof errStatus === 'number' ? errStatus : 500
  if (status === 500) {
    console.error(`${tag} error:`, err)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
  const message = err instanceof Error ? err.message : 'Error'
  return NextResponse.json({ error: message }, { status })
}
