import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { initiativeService } from '@/lib/services/initiative.service'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { updateInitiativeSchema } from '@/lib/validation/initiative'

interface Params {
  params: Promise<{ initiativeId: string }>
}

/**
 * GET /api/initiatives/[initiativeId]
 *
 * One initiative with its lineage — the consumed Ideas and the attached Tasks.
 * Scoped to the caller's team: an id belonging to another team returns 404
 * (same as a genuinely missing row), so the boundary can't be probed.
 */
export async function GET(
  request: NextRequest,
  { params }: Params
): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  try {
    const { initiativeId } = await params
    const initiative = await initiativeService.getDetail({
      workspaceId: identity.workspaceId,
      initiativeId,
    })
    return NextResponse.json({ initiative })
  } catch (err) {
    return serviceErrorResponse(err, 'GET /api/initiatives/[initiativeId]')
  }
}

/**
 * PATCH /api/initiatives/[initiativeId]
 *
 * Update an initiative's name (goal), description, status, priority or
 * start/target dates (LUM-821, `lumo initiative update`). The path segment
 * accepts the cuid or the `LUM-INIT-<n>` ref; team-scoped like GET.
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
  const parsed = updateInitiativeSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const { initiativeId } = await params
    const initiative = await initiativeService.update({
      workspaceId: identity.workspaceId,
      ref: initiativeId,
      input: parsed.data,
    })
    return NextResponse.json({ initiative })
  } catch (err) {
    return serviceErrorResponse(err, 'PATCH /api/initiatives/[initiativeId]')
  }
}
