import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'

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

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        agentStatus: true,
        sandboxId: true,
        clarifyQuestion: true,
        clarifyContext: true,
        clarifyReply: true,
        githubPrUrl: true,
        githubPrNumber: true,
        githubPrStatus: true,
        project: { select: { workspaceId: true } },
      },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (task.project.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json({
      taskId: task.id,
      agentStatus: task.agentStatus,
      clarifyQuestion: task.clarifyQuestion,
      clarifyContext: task.clarifyContext,
      clarifyReply: task.clarifyReply,
      githubPrUrl: task.githubPrUrl,
      githubPrNumber: task.githubPrNumber,
      githubPrStatus: task.githubPrStatus,
    })
  } catch (error) {
    console.error('[agent/status] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
