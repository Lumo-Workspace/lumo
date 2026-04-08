import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { zodError, requireTaskMember } from '@/lib/api/helpers'
import { taskRepository } from '@/lib/repositories/task.repository'
import { agentService } from '@/lib/services/agent.service'
import { Sandbox } from '@e2b/code-interpreter'

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

    const task = await taskRepository.findForAgent(taskId)

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

    const activeRun = await agentService.cancelAgent(
      taskId,
      verifiedTask.projectId,
      verifiedTask.agentStatus
    )

    // Kill E2B sandbox if one exists
    if (activeRun?.sandboxId) {
      try {
        const sandbox = await Sandbox.connect(activeRun.sandboxId)
        await sandbox.kill()
      } catch {
        // Sandbox may have already exited — not a fatal error
      }
    }

    return NextResponse.json({ status: 'cancelled', taskId })
  } catch (error) {
    console.error('[agent/cancel] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
