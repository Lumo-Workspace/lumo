import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { updateDocumentShareSchema } from '@/lib/validation/schemas'

async function checkManagePermission(
  documentId: string,
  memberId: string,
  workspaceId: string
) {
  const doc = await prisma.document.findFirst({
    where: {
      id: documentId,
      workspaceId,
      OR: [
        { createdById: memberId },
        { shares: { some: { memberId, role: 'MANAGER' } } },
      ],
    },
  })
  return doc
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id, shareId } = await params
  const doc = await checkManagePermission(id, ws.member.id, ws.workspaceId)
  if (!doc) {
    return NextResponse.json(
      { error: 'Not found or no permission' },
      { status: 404 }
    )
  }

  const body = await request.json()
  const parsed = updateDocumentShareSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const updated = await prisma.documentShare.update({
    where: { id: shareId },
    data: { role: parsed.data.role },
  })

  return NextResponse.json({ share: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; shareId: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id, shareId } = await params
  const doc = await checkManagePermission(id, ws.member.id, ws.workspaceId)
  if (!doc) {
    return NextResponse.json(
      { error: 'Not found or no permission' },
      { status: 404 }
    )
  }

  await prisma.documentShare.delete({ where: { id: shareId } })

  return NextResponse.json({ success: true })
}
