import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { documentService } from '@/lib/services'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id, taskId } = await params

  try {
    const result = await documentService.removeExplicitMention(
      id,
      taskId,
      identity.workspaceId,
      identity.memberId
    )
    if ('refused' in result && result.refused === true) {
      return NextResponse.json(
        { error: result.reason, removed: 0 },
        { status: 409 }
      )
    }
    return NextResponse.json(result, { status: 200 })
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
