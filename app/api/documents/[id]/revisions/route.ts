import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { createManualRevisionSchema } from '@/lib/validation/revision'
import { documentRevisionService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

function errorResponse(error: unknown) {
  if (error instanceof Error && 'status' in error) {
    return NextResponse.json(
      { error: error.message },
      { status: (error as Error & { status: number }).status }
    )
  }
  console.error('[doc-revisions] unexpected error:', error)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params
    const revisions = await documentRevisionService.listRevisions(
      id,
      identity.memberId,
      identity.workspaceId
    )
    return NextResponse.json({ revisions })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const body = await request.json()
    const parsed = createManualRevisionSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const revision = await documentRevisionService.createManualSnapshot(
      id,
      identity.memberId,
      identity.workspaceId,
      parsed.data.label
    )
    return NextResponse.json({ revision }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
