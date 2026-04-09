import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { createDocumentShareSchema } from '@/lib/validation/schemas'
import { documentRepository } from '@/lib/repositories'

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
  const doc = await documentRepository.findManageable(
    id,
    ws.member.id,
    ws.workspaceId
  )
  if (!doc) {
    return NextResponse.json(
      { error: 'Not found or no permission' },
      { status: 404 }
    )
  }

  const shares = await documentRepository.findSharesByDocument(id)

  return NextResponse.json({ shares })
}

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
  const doc = await documentRepository.findManageable(
    id,
    ws.member.id,
    ws.workspaceId
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
    id,
    parsed.data.memberId,
    parsed.data.role,
    doc.visibility
  )

  return NextResponse.json({ share }, { status: 201 })
}
