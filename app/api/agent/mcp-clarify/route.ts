import { NextResponse } from 'next/server'
import { notificationRepository } from '@/lib/repositories/notification.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { transitionAgentStatus } from '@/lib/services'
import { pushAgentEvent } from '@/lib/integrations/pusher'
import { notifyAgentClarify } from '@/lib/services/notification.service'
import { validateMcpToken } from '@/lib/auth/mcp-auth'

/**
 * POST /api/agent/mcp-clarify
 *
 * Called by the MCP server running inside the E2B sandbox when the agent
 * invokes the `ask_user` tool. This is the fast path — it creates the
 * clarify DB record and sends notifications immediately, without waiting
 * for the file-polling monitor to detect the question file.
 *
 * Body: { taskId, question, context? }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { taskId, question, context } = body

    if (!taskId || !question) {
      return NextResponse.json(
        { error: 'taskId and question are required' },
        { status: 400 }
      )
    }

    const authorized = await validateMcpToken(request, taskId)
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Avoid duplicates — check if there's already a pending clarify
    const existing = await notificationRepository.findPendingClarify(taskId)
    if (existing) {
      return NextResponse.json({ ok: true, clarifyId: existing.id })
    }

    const task = await taskRepository.findProjectId(taskId)
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const clarify = await notificationRepository.createClarify({
      taskId,
      question,
      context: context ?? null,
    })

    await transitionAgentStatus(taskId, task.projectId, 'INPUT_REQUIRED', {
      inputReason: 'clarify',
    })
    await notifyAgentClarify(taskId, clarify.id)
    await pushAgentEvent(taskId, {
      type: 'agent:clarify',
      question,
      context: context ?? null,
    })

    return NextResponse.json({ ok: true, clarifyId: clarify.id })
  } catch (error) {
    console.error('[mcp-clarify] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
