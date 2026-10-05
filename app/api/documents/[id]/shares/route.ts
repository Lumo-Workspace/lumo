import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { createDocumentShareSchema } from '@/lib/validation/schemas'
import { documentRepository } from '@/lib/repositories'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id } = await params
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

  const shares = await documentRepository.findSharesByDocument(doc.id)

  return NextResponse.json({ shares })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id } = await params
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
  const parsed = createDocumentShareSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const share = await documentRepository.upsertShareTransaction(
    doc.id,
    identity.workspaceId,
    parsed.data.memberId,
    parsed.data.role,
    doc.visibility
  )

  return NextResponse.json({ share }, { status: 201 })
}
