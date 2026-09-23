import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { createInitiativeUpdateSchema } from '@/lib/validation/initiative'
import { initiativeService } from '@/lib/services/initiative.service'

interface Params {
  params: Promise<{ initiativeId: string }>
}

/**
 * GET /api/initiatives/[initiativeId]/updates
 * An initiative's progress posts, newest first (LUM-821). The path segment
 * accepts the cuid or the `LUM-INIT-<n>` ref.
 */
export async function GET(
  request: NextRequest,
  { params }: Params
): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  try {
    const { initiativeId } = await params
    const updates = await initiativeService.listProgressUpdates({
      workspaceId: identity.workspaceId,
      ref: initiativeId,
    })
    return NextResponse.json({ updates })
  } catch (err) {
    return serviceErrorResponse(
      err,
      'GET /api/initiatives/[initiativeId]/updates'
    )
  }
}

/**
 * POST /api/initiatives/[initiativeId]/updates
 * Append a progress post `{ body, health? }` authored by the caller (LUM-821).
 */
export async function POST(
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
  const parsed = createInitiativeUpdateSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const { initiativeId } = await params
    const update = await initiativeService.postProgressUpdate({
      workspaceId: identity.workspaceId,
      ref: initiativeId,
      authorMemberId: identity.memberId,
      input: parsed.data,
    })
    return NextResponse.json({ update }, { status: 201 })
  } catch (err) {
    return serviceErrorResponse(
      err,
      'POST /api/initiatives/[initiativeId]/updates'
    )
  }
}
