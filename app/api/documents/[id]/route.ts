import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveProjectRef, zodError } from '@/lib/api/helpers'
import { updateDocumentSchema } from '@/lib/validation/schemas'
import { documentService, type UpdateDocumentInput } from '@/lib/services'
import { memberAuditContext } from '@/lib/api/audit-context'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id } = await params

  try {
    const result = await documentService.getDocument(
      id,
      identity.memberId,
      identity.workspaceId
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
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id } = await params

  const body = await request.json()
  const parsed = updateDocumentSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  // Resolve projectRef before any write so the 404/409 is reported atomically.
  // projectRef takes precedence over projectId:
  //   undefined → field absent → don't touch projectId
  //   null      → clear binding
  //   string    → resolve via projectRepository
  let projectIdField: string | null | undefined
  if (parsed.data.projectRef !== undefined) {
    if (parsed.data.projectRef === null) {
      projectIdField = null
    } else {
      try {
        projectIdField = await resolveProjectRef(
          identity.workspaceId,
          parsed.data.projectRef
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
  } else if (parsed.data.projectId !== undefined) {
    projectIdField = parsed.data.projectId ?? null
  }

  try {
    const data: UpdateDocumentInput = {}
    if (parsed.data.title !== undefined) data.title = parsed.data.title
    if (parsed.data.content !== undefined) data.content = parsed.data.content
    if (parsed.data.contentMarkdown !== undefined)
      data.contentMarkdown = parsed.data.contentMarkdown
    if (parsed.data.emoji !== undefined) data.emoji = parsed.data.emoji ?? null
    if (parsed.data.visibility !== undefined)
      data.visibility = parsed.data.visibility
    if (projectIdField !== undefined) data.projectId = projectIdField
    if (parsed.data.sortOrder !== undefined)
      data.sortOrder = parsed.data.sortOrder
    if (parsed.data.publicToken !== undefined)
      data.publicToken = parsed.data.publicToken ?? null
    if (parsed.data.tags !== undefined) data.tags = parsed.data.tags
    if (parsed.data.tagIds !== undefined) data.tagIds = parsed.data.tagIds
    if (parsed.data.addTagIds !== undefined)
      data.addTagIds = parsed.data.addTagIds
    if (parsed.data.removeTagIds !== undefined)
      data.removeTagIds = parsed.data.removeTagIds
    if (parsed.data.childOrder !== undefined)
      data.childOrder = parsed.data.childOrder
    if (parsed.data.ifRevision !== undefined)
      data.ifRevision = parsed.data.ifRevision
    if (parsed.data.allowShrink !== undefined)
      data.allowShrink = parsed.data.allowShrink

    const document = await documentService.updateDocument(
      id,
      identity.memberId,
      identity.workspaceId,
      data,
      {
        audit: memberAuditContext(
          request.headers,
          { clerkId: identity.clerkId, memberId: identity.memberId },
          identity.source
        ),
      }
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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id } = await params

  try {
    await documentService.deleteDocument(
      id,
      identity.memberId,
      identity.workspaceId,
      identity.clerkId
    )
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
