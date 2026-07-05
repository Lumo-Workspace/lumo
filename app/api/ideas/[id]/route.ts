import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { updateIdeaSchema } from '@/lib/validation/idea'
import { ideaService } from '@/lib/services'

interface Params {
  params: Promise<{ id: string }>
}

/**
 * PATCH /api/ideas/[id]
 *
 * Edit a captured idea's statement from the detail slide-over (LUM-683). Auth
 * via Clerk (web). Scoped to the caller's default team: an id in another team
 * returns 404 (same as a genuinely missing row), so the boundary can't be
 * probed. Returns the updated pool-view idea (with lineage).
 */
export async function PATCH(
  request: NextRequest,
  { params }: Params
): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = updateIdeaSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const { id } = await params
    const idea = await ideaService.updateStatement({
      workspaceId: identity.workspaceId,
      ideaId: id,
      input: parsed.data,
    })
    return NextResponse.json({ idea })
  } catch (err) {
    return errorResponse(err, 'PATCH /api/ideas/[id]')
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
