import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { updateDocumentSchema } from '@/lib/validation/schemas'
import { documentService, type UpdateDocumentInput } from '@/lib/services'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params

  try {
    const result = await documentService.getDocument(
      id,
      ws.member.id,
      ws.workspaceId
    )
    return NextResponse.json(result)
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

export async function PATCH(
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
  const parsed = updateDocumentSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const data: UpdateDocumentInput = {}
    if (parsed.data.title !== undefined) data.title = parsed.data.title
    if (parsed.data.content !== undefined) data.content = parsed.data.content
    if (parsed.data.contentMarkdown !== undefined)
      data.contentMarkdown = parsed.data.contentMarkdown
    if (parsed.data.emoji !== undefined) data.emoji = parsed.data.emoji ?? null
    if (parsed.data.visibility !== undefined)
      data.visibility = parsed.data.visibility
    if (parsed.data.projectId !== undefined)
      data.projectId = parsed.data.projectId ?? null
    if (parsed.data.sortOrder !== undefined)
      data.sortOrder = parsed.data.sortOrder
    if (parsed.data.publicToken !== undefined)
      data.publicToken = parsed.data.publicToken ?? null
    if (parsed.data.tags !== undefined) data.tags = parsed.data.tags
    if (parsed.data.tagIds !== undefined) data.tagIds = parsed.data.tagIds
    if (parsed.data.childOrder !== undefined)
      data.childOrder = parsed.data.childOrder

    const document = await documentService.updateDocument(
      id,
      ws.member.id,
      ws.workspaceId,
      data
    )
    return NextResponse.json({ document })
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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params

  try {
    await documentService.deleteDocument(id, ws.member.id, ws.workspaceId)
    return NextResponse.json({ success: true })
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
