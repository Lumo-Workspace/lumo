import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { documentService } from '@/lib/services'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id, taskId } = await params

  try {
    const result = await documentService.removeExplicitMention(
      id,
      taskId,
      ws.workspaceId,
      ws.member.id
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
