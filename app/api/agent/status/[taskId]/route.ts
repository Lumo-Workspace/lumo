import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories/task.repository'
import { notificationRepository } from '@/lib/repositories/notification.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

type Params = { params: Promise<{ taskId: string }> }

/**
 * GET /api/agent/status/[taskId]?workspaceId=...
 * Returns the current agent execution status for a task.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const { taskId } = await params
    const workspaceId = req.nextUrl.searchParams.get('workspaceId')
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId query param required' },
        { status: 400 }
      )
    }

    const memberResult = await requireWorkspaceMember(workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    const task = await taskRepository.findForAgent(taskId)

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (task.project.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [pendingClarify, activePr] = await Promise.all([
      notificationRepository.findPendingClarify(taskId),
      pullRequestRepository.findActivePr(taskId),
    ])

    return NextResponse.json({
      taskId: task.id,
      agentStatus: task.agentStatus,
      clarifyQuestion: pendingClarify?.question ?? null,
      clarifyContext: pendingClarify?.context ?? null,
      clarifyReply: pendingClarify?.reply ?? null,
      githubPrUrl: activePr?.url ?? null,
      githubPrNumber: activePr?.number ?? null,
      githubPrStatus: activePr?.state ?? null,
    })
  } catch (error) {
    console.error('[agent/status] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
