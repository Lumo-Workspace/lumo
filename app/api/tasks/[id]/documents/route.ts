import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { miscRepository } from '@/lib/repositories'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id: taskId } = await params
  const memberId = ws.member.id

  const mentions = await miscRepository.findDocumentMentionsByTask(
    taskId,
    ws.workspaceId,
    memberId
  )

  const documents = mentions.map(m => m.document)

  return NextResponse.json({ documents })
}
