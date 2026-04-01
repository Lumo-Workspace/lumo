import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Sandbox } from '@e2b/code-interpreter'
import { requireAuth } from '@/lib/auth'
import { zodError, requireTaskMember } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'
import { pushAgentEvent } from '@/lib/pusher/server'
import { transitionAgentStatus } from '@/lib/agent/state-machine'

const bodySchema = z.object({
  taskId: z.string().min(1),
})

/**
 * POST /api/agent/cancel
 * Kills the E2B sandbox and marks the task as cancelled.
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await req.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)
    const { taskId } = parsed.data

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        agentStatus: true,
        projectId: true,
        project: { select: { workspaceId: true } },
      },
    })

    const taskCheck = await requireTaskMember(task, userId)
    if (taskCheck instanceof NextResponse) return taskCheck
    const verifiedTask = taskCheck.task

    if (
      verifiedTask.agentStatus !== 'WORKING' &&
      verifiedTask.agentStatus !== 'INPUT_REQUIRED'
    ) {
      return NextResponse.json(
        { error: 'Agent is not running' },
        { status: 409 }
      )
    }

    // Find the active AgentRun and kill its sandbox
    const activeRun = await prisma.agentRun.findFirst({
      where: { taskId, status: 'WORKING' },
      select: { id: true, sandboxId: true },
    })

    if (activeRun?.sandboxId) {
      try {
        const sandbox = await Sandbox.connect(activeRun.sandboxId)
        await sandbox.kill()
      } catch {
        // Sandbox may have already exited — not a fatal error
      }
    }

    await transitionAgentStatus(taskId, verifiedTask.projectId, 'CANCELED', {
      currentStatus: verifiedTask.agentStatus,
    })

    if (activeRun) {
      await prisma.agentRun.update({
        where: { id: activeRun.id },
        data: { status: 'CANCELED', finishedAt: new Date() },
      })
    }

    await pushAgentEvent(taskId, {
      type: 'agent:failed',
      error: 'Cancelled by user',
    })

    return NextResponse.json({ status: 'cancelled', taskId })
  } catch (error) {
    console.error('[agent/cancel] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
