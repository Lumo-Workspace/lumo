import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id: taskId } = await params
  const memberId = ws.member.id

  const mentions = await prisma.documentMention.findMany({
    where: {
      taskId,
      document: {
        workspaceId: ws.workspaceId,
        OR: [
          { createdById: memberId },
          { visibility: 'WORKSPACE' },
          { shares: { some: { memberId } } },
        ],
      },
    },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          emoji: true,
          updatedAt: true,
        },
      },
    },
  })

  const documents = mentions.map(m => m.document)

  return NextResponse.json({ documents })
}
