import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Sandbox } from '@e2b/code-interpreter'
import { requireAuth } from '@/lib/auth'
import { zodError, requireTaskMember } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'
import { pushAgentEvent, pushProjectEvent } from '@/lib/pusher/server'

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
        sandboxId: true,
        projectId: true,
        project: { select: { workspaceId: true } },
      },
    })

    const taskCheck = await requireTaskMember(task, userId)
    if (taskCheck instanceof NextResponse) return taskCheck
    const verifiedTask = taskCheck.task

    if (
      verifiedTask.agentStatus !== 'RUNNING' &&
      verifiedTask.agentStatus !== 'PAUSED'
    ) {
      return NextResponse.json(
        { error: 'Agent is not running' },
        { status: 409 }
      )
    }

    // Kill the sandbox if we have its ID
    if (verifiedTask.sandboxId) {
      try {
        const sandbox = await Sandbox.connect(verifiedTask.sandboxId)
        await sandbox.kill()
      } catch {
        // Sandbox may have already exited — not a fatal error
      }
    }

    await prisma.task.update({
      where: { id: taskId },
      data: { agentStatus: 'CANCELLED', sandboxId: null },
    })

    await pushAgentEvent(taskId, {
      type: 'agent:failed',
      error: 'Cancelled by user',
    })
    await pushProjectEvent(verifiedTask.projectId, {
      type: 'task:updated',
      taskId,
      fields: ['agentStatus'],
      patch: { agentStatus: 'CANCELLED' },
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
