import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveProjectRef, zodError } from '@/lib/api/helpers'
import { createDocumentSchema } from '@/lib/validation/schemas'
import { documentService } from '@/lib/services'

export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

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
    identity.workspaceId,
    identity.memberId,
    filters
  )

  return NextResponse.json({ documents })
}

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const body = await request.json()
  const parsed = createDocumentSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const {
    title,
    emoji,
    parentId: docParentId,
    projectId: docProjectId,
    projectRef,
    visibility,
    contentMarkdown,
    tagIds,
    templateId,
  } = parsed.data

  // projectRef (CLI's name/slug input) wins over projectId when both are
  // present. Mirrors `task create` resolution.
  let resolvedProjectId: string | null = docProjectId ?? null
  if (projectRef !== undefined) {
    try {
      resolvedProjectId = await resolveProjectRef(
        identity.workspaceId,
        projectRef
      )
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

  try {
    const document = await documentService.createDocument(
      identity.workspaceId,
      identity.memberId,
      {
        title,
        visibility,
        emoji: emoji ?? null,
        parentId: docParentId ?? null,
        projectId: resolvedProjectId,
        ...(contentMarkdown !== undefined ? { contentMarkdown } : {}),
        ...(tagIds !== undefined ? { tagIds } : {}),
        ...(templateId !== undefined ? { templateId } : {}),
      }
    )
    return NextResponse.json({ document }, { status: 201 })
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
