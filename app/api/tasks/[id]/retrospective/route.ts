import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskService, retrospectiveService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/retrospective — 交付回顾：交付时固化的预测 vs 实际。
 * 无快照（老任务 / 项目早期）返回 { retrospective: null }。
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const taskDetail = await taskService.getTaskDetail(id)
    if (!taskDetail) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      taskDetail.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const retrospective = await retrospectiveService.getRetrospective(id)
    return NextResponse.json({ retrospective })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
