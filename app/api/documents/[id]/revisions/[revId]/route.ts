import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { documentRevisionService } from '@/lib/services'

type Params = { params: Promise<{ id: string; revId: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id, revId } = await params
    const revision = await documentRevisionService.getRevision(
      id,
      revId,
      identity.memberId,
      identity.workspaceId
    )
    return NextResponse.json({ revision })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    throw error
  }
}
