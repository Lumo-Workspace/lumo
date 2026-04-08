import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { memberRepository } from '@/lib/repositories/member.repository'
import { draftService } from '@/lib/services/draft.service'

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

    const actor = await memberRepository.findActorByMemberId(member.id)
    if (!actor) {
      return NextResponse.json({ error: 'Actor not found' }, { status: 404 })
    }

    try {
      await draftService.deleteDraft(id, actor.id)
    } catch (err) {
      const error = err as Error & { status?: number }
      if (error.status === 404) {
        return NextResponse.json({ error: error.message }, { status: 404 })
      }
      throw err
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
