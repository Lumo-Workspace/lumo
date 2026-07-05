import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { updateIdeaSchema, updateIdeaStatusSchema } from '@/lib/validation/idea'
import { ideaService } from '@/lib/services'

/**
 * PATCH /api/ideas/[id]
 *
 * Two edits share this route, dispatched by the body shape:
 *  - a `status` field → a lifecycle status change (LUM-679), validated against
 *    the transition rules in the service;
 *  - otherwise a `statement` field → a text edit from the detail slide-over
 *    (LUM-683).
 *
 * `[id]` is a cuid id (web) or a `<TEAM>-I<n>` identifier / bare number (CLI —
 * `lumo idea update`). Auth via Clerk (web) or Bearer (CLI). Everything is
 * scoped to the caller's default team: an id in another team returns 404 (same
 * as a genuinely missing row), so the boundary can't be probed.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const isStatusEdit =
    typeof body === 'object' && body !== null && 'status' in body

  try {
    if (isStatusEdit) {
      const parsed = updateIdeaStatusSchema.safeParse(body)
      if (!parsed.success) return zodError(parsed)
      const idea = await ideaService.updateStatus({
        workspaceId: identity.workspaceId,
        ideaRef: id,
        status: parsed.data.status,
      })
      return NextResponse.json({ idea })
    }

    const parsed = updateIdeaSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)
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
