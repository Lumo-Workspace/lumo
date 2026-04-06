import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { moveDocumentSchema } from '@/lib/validation/schemas'

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
  const doc = await prisma.document.findFirst({
    where: {
      id,
      workspaceId: ws.workspaceId,
      OR: [
        { createdById: ws.member.id },
        { visibility: 'WORKSPACE' },
        {
          shares: {
            some: {
              memberId: ws.member.id,
              role: { in: ['EDITOR', 'MANAGER'] },
            },
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

  const body = await request.json()
  const parsed = moveDocumentSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  // Prevent moving a document into its own subtree
  if (parsed.data.parentId) {
    let current: string | null = parsed.data.parentId
    while (current) {
      if (current === id) {
        return NextResponse.json(
          { error: 'Cannot move a document into its own subtree' },
          { status: 400 }
        )
      }
      const parent: { parentId: string | null } | null =
        await prisma.document.findUnique({
          where: { id: current },
          select: { parentId: true },
        })
      current = parent?.parentId ?? null
    }
  }

  const updated = await prisma.document.update({
    where: { id },
    data: {
      parentId: parsed.data.parentId,
      sortOrder: parsed.data.sortOrder,
    },
  })

  return NextResponse.json({ document: updated })
}
