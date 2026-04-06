import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { createDocumentShareSchema } from '@/lib/validation/schemas'

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
  const doc = await prisma.document.findFirst({
    where: {
      id,
      workspaceId: ws.workspaceId,
      OR: [
        { createdById: ws.member.id },
        {
          shares: {
            some: { memberId: ws.member.id, role: { in: ['MANAGER'] } },
          },
        },
      ],
    },
  })
  if (!doc) {
    return NextResponse.json(
      { error: 'Not found or no permission' },
      { status: 404 }
    )
  }

  const shares = await prisma.documentShare.findMany({
    where: { documentId: id },
    include: {
      member: {
        select: { id: true, clerkId: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

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
  const doc = await prisma.document.findFirst({
    where: {
      id,
      workspaceId: ws.workspaceId,
      OR: [
        { createdById: ws.member.id },
        { shares: { some: { memberId: ws.member.id, role: 'MANAGER' } } },
      ],
    },
  })
  if (!doc) {
    return NextResponse.json(
      { error: 'Not found or no permission' },
      { status: 404 }
    )
  }

  const body = await request.json()
  const parsed = createDocumentShareSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const share = await prisma.$transaction(async tx => {
    // Auto-set visibility to SHARED if currently PRIVATE
    if (doc.visibility === 'PRIVATE') {
      await tx.document.update({
        where: { id },
        data: { visibility: 'SHARED' },
      })
    }

    return tx.documentShare.upsert({
      where: {
        documentId_memberId: { documentId: id, memberId: parsed.data.memberId },
      },
      create: {
        documentId: id,
        memberId: parsed.data.memberId,
        role: parsed.data.role,
      },
      update: { role: parsed.data.role },
      include: {
        member: {
          select: { id: true, clerkId: true },
        },
      },
    })
  })

  return NextResponse.json({ share }, { status: 201 })
}
