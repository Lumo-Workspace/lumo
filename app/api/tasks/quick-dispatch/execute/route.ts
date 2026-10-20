import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { zodError, requireWorkspaceByUrl } from '@/lib/api/helpers'
import { executeQuickDispatchSchema } from '@/lib/validation/schemas'
import { memberRepository } from '@/lib/repositories'
import { getHumanActorId } from '@/lib/actor'
import { quickDispatchService } from '@/lib/services/quick-dispatch.service'

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = executeQuickDispatchSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { actions, workspaceUrl } = parsed.data

    const wsResult = await requireWorkspaceByUrl(userId, workspaceUrl)
    if (wsResult instanceof NextResponse) return wsResult

    const workspaceId = wsResult.workspace.id

    const member = await memberRepository.findByWorkspaceAndClerkId(
      workspaceId,
      userId
    )
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const actorId = await getHumanActorId(member.id)
    if (!actorId) {
      return NextResponse.json({ error: 'Actor not found' }, { status: 404 })
    }

    const results = await quickDispatchService.executeActions(
      actions,
      workspaceId,
      actorId,
      userId,
      member.id
    )

    return NextResponse.json({ results })
  } catch (error) {
    console.error('POST /api/tasks/quick-dispatch/execute error:', error)
    return NextResponse.json(
      { error: 'Failed to execute quick dispatch actions' },
      { status: 500 }
    )
  }
}
