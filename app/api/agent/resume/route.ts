import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'
import { resumeAgent } from '@/lib/agent/resume'

const bodySchema = z.object({
  taskId: z.string().min(1),
  workspaceId: z.string().min(1),
  reply: z.string().min(1),
})

/**
 * POST /api/agent/resume
 * Sends a clarification reply so the agent can continue execution.
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await req.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)
    const { taskId, workspaceId, reply } = parsed.data

    const memberResult = await requireWorkspaceMember(workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        agentStatus: true,
        sandboxId: true,
        project: { select: { workspaceId: true } },
      },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    if (task.project.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (task.agentStatus !== 'PAUSED') {
      return NextResponse.json(
        { error: 'Agent is not paused — nothing to resume' },
        { status: 409 }
      )
    }

    if (!task.sandboxId) {
      return NextResponse.json(
        { error: 'No sandbox ID on record — cannot resume' },
        { status: 422 }
      )
    }

    await resumeAgent(taskId, task.sandboxId, reply)

    return NextResponse.json({ status: 'resumed', taskId })
  } catch (error) {
    console.error('[agent/resume] Unexpected error:', error)
    const message =
      error instanceof Error ? error.message : 'Internal server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
