import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { taskCriteriaConfirmService } from '@/lib/services/task-criteria-confirm.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/tasks/[id]/criteria/confirm — 记录人对验收合同的确认（LUM-789）。
 * 无请求体：确认的是整份活合同，没有可选参数。
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  try {
    const result = await taskCriteriaConfirmService.confirmContract(
      task.id,
      identity.memberId
    )
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? (err as { status: number }).status
        : 500
    const message =
      status === 500 || !(err instanceof Error)
        ? 'Internal Server Error'
        : err.message
    return NextResponse.json({ error: message }, { status })
  }
}
