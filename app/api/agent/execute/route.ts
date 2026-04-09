import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { zodError, requireTaskMember } from '@/lib/api/helpers'
import { taskRepository } from '@/lib/repositories/task.repository'
import { executeAgent } from '@/lib/services'
import {
  isAgentServiceEnabled,
  proxyToAgentService,
} from '@/lib/integrations/sandbox'

// Setup phase only (clone, install, branch) — typically < 3 min
export const maxDuration = 300

const bodySchema = z.object({
  taskId: z.string().min(1),
})

/**
 * POST /api/agent/execute
 * Triggers the Lumo coding agent for a task.
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

    const rawTask = await taskRepository.findForAgentExecute(taskId)

    const taskCheck = await requireTaskMember(rawTask, userId)
    if (taskCheck instanceof NextResponse) return taskCheck
    const task = taskCheck.task

    const hasRepo = task.repositoryId || task.project.repositories.length > 0
    if (!hasRepo) {
      return NextResponse.json(
        { error: 'No GitHub repo configured for this project' },
        { status: 422 }
      )
    }

    if (task.agentStatus === 'WORKING') {
      return NextResponse.json(
        { error: 'Agent is already running for this task' },
        { status: 409 }
      )
    }

    // Proxy to agent-server if configured, otherwise run locally
    if (isAgentServiceEnabled()) {
      const { status, data } = await proxyToAgentService('/api/agent/execute', {
        taskId,
        actorClerkId: userId,
        trigger: 'initial',
      })
      return NextResponse.json(data, { status })
    }

    const result = await executeAgent({
      taskId,
      actorClerkId: userId,
      trigger: 'initial',
    }).catch(err => {
      console.error(`[agent/execute] Task ${taskId} failed:`, err)
      return { outcome: 'failed' as const, error: String(err) }
    })

    return NextResponse.json(
      { status: result.outcome, taskId },
      { status: 202 }
    )
  } catch (error) {
    console.error('[agent/execute] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
