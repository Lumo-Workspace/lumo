import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { createDocumentSchema } from '@/lib/validation/schemas'
import { documentService } from '@/lib/services'

export async function GET(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { searchParams } = request.nextUrl
  const visibility = searchParams.get('visibility')
  const projectId = searchParams.get('projectId')
  const parentId = searchParams.get('parentId')
  const search = searchParams.get('search')
  const rootOnly = searchParams.get('rootOnly') === 'true'

  const filters: Record<string, unknown> = {}
  if (visibility) filters.visibility = visibility
  if (projectId) filters.projectId = projectId
  if (parentId) filters.parentId = parentId
  if (search) filters.search = search
  if (rootOnly) filters.rootOnly = true

  const documents = await documentService.listDocuments(
    ws.workspaceId,
    ws.member.id,
    filters
  )

  return NextResponse.json({ documents })
}

export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const body = await request.json()
  const parsed = createDocumentSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const {
    title,
    emoji,
    parentId: docParentId,
    projectId: docProjectId,
    visibility,
    contentMarkdown,
    tagIds,
  } = parsed.data
  const document = await documentService.createDocument(
    ws.workspaceId,
    ws.member.id,
    {
      title,
      visibility,
      emoji: emoji ?? null,
      parentId: docParentId ?? null,
      projectId: docProjectId ?? null,
      ...(contentMarkdown !== undefined ? { contentMarkdown } : {}),
      ...(tagIds !== undefined ? { tagIds } : {}),
    }
  )

  return NextResponse.json({ document }, { status: 201 })
}
