import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const { id } = await params

    const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
    const wsResult = await requireWorkspaceByUrl(userId, workspaceUrl)
    if (wsResult instanceof NextResponse) return wsResult

    const { member } = wsResult

    const actor = await prisma.actor.findUnique({
      where: { memberId: member.id },
    })
    if (!actor) {
      return NextResponse.json({ error: 'Actor not found' }, { status: 404 })
    }

    const draft = await prisma.draft.findUnique({ where: { id } })
    if (!draft || draft.creatorId !== actor.id) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }

    await prisma.draft.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
