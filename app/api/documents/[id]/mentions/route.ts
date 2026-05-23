import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { createDocumentMentionSchema } from '@/lib/validation/schemas'
import { documentService } from '@/lib/services'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params
  const body = await request.json()
  const parsed = createDocumentMentionSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const mention = await documentService.addExplicitMention(
      id,
      parsed.data.taskIdentifier,
      ws.workspaceId,
      ws.member.id
    )
    return NextResponse.json({ mention }, { status: 201 })
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
