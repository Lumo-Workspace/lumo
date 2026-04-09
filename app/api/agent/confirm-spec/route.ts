import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { zodError, requireTaskMember } from '@/lib/api/helpers'
import { taskRepository } from '@/lib/repositories/task.repository'
import { executeAgent } from '@/lib/agent/execute'
import {
  isAgentServiceEnabled,
  proxyToAgentService,
} from '@/lib/integrations/sandbox'

const bodySchema = z.object({
  taskId: z.string().min(1),
  spec: z.string().min(1, 'Spec cannot be empty'),
})

/**
 * POST /api/agent/confirm-spec
 * Saves the confirmed (possibly edited) spec and kicks off agent execution.
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await req.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)
    const { taskId, spec } = parsed.data

    const rawTask = await taskRepository.findForAgent(taskId)

    const taskCheck = await requireTaskMember(rawTask, userId)
    if (taskCheck instanceof NextResponse) return taskCheck
    const task = taskCheck.task

    if (
      task.agentStatus !== 'INPUT_REQUIRED' ||
      task.inputReason !== 'spec_review'
    ) {
      return NextResponse.json(
        { error: 'Task is not awaiting spec confirmation' },
        { status: 409 }
      )
    }

    // Save confirmed spec
    await taskRepository.updateSpec(taskId, spec)

    if (isAgentServiceEnabled()) {
      const { status, data } = await proxyToAgentService('/api/agent/execute', {
        taskId,
        actorClerkId: userId,
        trigger: 'confirm_spec',
      })
      return NextResponse.json(data, { status })
    }

    const result = await executeAgent({
      taskId,
      actorClerkId: userId,
      trigger: 'confirm_spec',
    }).catch(err => {
      console.error(`[agent/confirm-spec] Task ${taskId} failed:`, err)
      return { outcome: 'failed' as const, error: String(err) }
    })

    return NextResponse.json(
      { status: result.outcome, taskId },
      { status: 202 }
    )
  } catch (error) {
    console.error('[agent/confirm-spec] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
