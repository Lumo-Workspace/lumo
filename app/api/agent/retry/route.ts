import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { z } from 'zod'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { executeAgent } from '@/lib/agent/execute'

const bodySchema = z.object({
  taskId: z.string().min(1),
})

/**
 * POST /api/agent/retry
 * Resets a failed/cancelled task and re-triggers agent execution.
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await req.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const { taskId } = parsed.data

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        agentStatus: true,
        project: { select: { workspaceId: true, githubRepo: true } },
      },
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    if (task.agentStatus !== 'failed' && task.agentStatus !== 'cancelled') {
      return NextResponse.json(
        { error: 'Can only retry failed or cancelled tasks' },
        { status: 409 }
      )
    }

    if (!task.project.githubRepo) {
      return NextResponse.json(
        { error: 'No GitHub repo configured for this project' },
        { status: 422 }
      )
    }

    // Reset state before re-running
    await prisma.task.update({
      where: { id: taskId },
      data: { agentStatus: 'idle', agentError: null, sandboxId: null },
    })

    waitUntil(
      executeAgent({ taskId, actorClerkId: userId }).catch(err => {
        console.error(`[agent/retry] Task ${taskId} failed:`, err)
      })
    )

    return NextResponse.json({ status: 'retrying', taskId })
  } catch (error) {
    console.error('[agent/retry] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
