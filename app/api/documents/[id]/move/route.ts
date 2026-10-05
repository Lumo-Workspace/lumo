import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { moveDocumentSchema } from '@/lib/validation/schemas'
import { documentRepository } from '@/lib/repositories'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id } = await params
  const doc = await documentRepository.findEditable(
    id,
    identity.memberId,
    identity.workspaceId
  )
  if (!doc) {
    return NextResponse.json(
      { error: 'Not found or no permission' },
      { status: 404 }
    )
  }

  const body = await request.json()
  const parsed = moveDocumentSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  // `findEditable` returns the resolved row even when `id` was a slug; use
  // the cuid for downstream mutations and cycle-detection comparisons.
  const docId = doc.id

  // Prevent moving a document into its own subtree
  if (parsed.data.parentId) {
    let current: string | null = parsed.data.parentId
    while (current) {
      if (current === docId) {
        return NextResponse.json(
          { error: 'Cannot move a document into its own subtree' },
          { status: 400 }
        )
      }
      const parent = await documentRepository.findParentId(
        current,
        identity.workspaceId
      )
      current = parent?.parentId ?? null
    }
  }

  const updated = await documentRepository.move(
    docId,
    identity.workspaceId,
    parsed.data.parentId,
    parsed.data.sortOrder
  )

  return NextResponse.json({ document: updated })
}
