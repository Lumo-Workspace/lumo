import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { transitionAgentStatus } from '@/lib/agent/state-machine'
import { pushAgentEvent } from '@/lib/pusher/server'
import { notifyAgentClarify } from '@/lib/notifications/notifyAgentActions'

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

    // Avoid duplicates — check if there's already a pending clarify
    const existing = await prisma.agentClarify.findFirst({
      where: { taskId, reply: null },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) {
      return NextResponse.json({ ok: true, clarifyId: existing.id })
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    })
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const clarify = await prisma.agentClarify.create({
      data: {
        taskId,
        question,
        context: context ?? null,
      },
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
