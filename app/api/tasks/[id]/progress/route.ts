import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { progressService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/progress — 交付中态：活预测 + 累计 actual 的 burn 对比。
 * task 不存在或不属于调用方 workspace → 404；无 session（交付前）仍返回
 * { progress: { sessionCount: 0, ... } }。LUM-1188：浏览器会话或 API key 均可读。
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id } = await params
    const task = await resolveTaskParam(id, identity.workspaceId)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const progress = await progressService.getProgress(task.id)
    return NextResponse.json({ progress })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
