import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { updateDocumentShareSchema } from '@/lib/validation/schemas'
import { documentRepository } from '@/lib/repositories'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id, shareId } = await params
  const doc = await documentRepository.findManageable(
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
  const parsed = updateDocumentShareSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const updated = await documentRepository.updateShare(
    shareId,
    parsed.data.role
  )

  return NextResponse.json({ share: updated })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id, shareId } = await params
  const doc = await documentRepository.findManageable(
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

  await documentRepository.deleteShare(shareId)

  return NextResponse.json({ success: true })
}
