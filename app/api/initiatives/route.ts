import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { createInitiativeSchema } from '@/lib/validation/initiative'
import { initiativeService } from '@/lib/services/initiative.service'

/**
 * POST /api/initiatives
 *
 * Create a team-level Initiative. Auth via
 * Clerk (web) or Bearer (CLI — `lumo initiative create`). Scoped to the
 * workspace's default team; `status` starts ACTIVE.
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

  const parsed = createInitiativeSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const initiative = await initiativeService.create({
      workspaceId: identity.workspaceId,
      input: parsed.data,
    })
    return NextResponse.json({ initiative }, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'POST /api/initiatives')
  }
}

/**
 * GET /api/initiatives
 *
 * The caller team's initiatives (list). Auth via Clerk (web) or Bearer (CLI).
 * Scoped to the workspace's default team; never leaks another team's
 * initiatives.
 */
export async function GET(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  try {
    const initiatives = await initiativeService.listForWorkspace({
      workspaceId: identity.workspaceId,
    })
    return NextResponse.json({ initiatives })
  } catch (err) {
    return errorResponse(err, 'GET /api/initiatives')
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
