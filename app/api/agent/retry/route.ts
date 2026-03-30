import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { zodError, requireTaskMember } from '@/lib/api/helpers'
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
    if (!parsed.success) return zodError(parsed)
    const { taskId } = parsed.data

    const rawTask = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        agentStatus: true,
        repositoryId: true,
        projectId: true,
        project: {
          select: {
            workspaceId: true,
            repositories: {
              where: { isDefault: true },
              select: { fullName: true },
              take: 1,
            },
          },
        },
      },
    })

    const taskCheck = await requireTaskMember(rawTask, userId)
    if (taskCheck instanceof NextResponse) return taskCheck
    const task = taskCheck.task

    if (
      task.agentStatus !== 'FAILED' &&
      task.agentStatus !== 'ERROR' &&
      task.agentStatus !== 'CANCELLED'
    ) {
      return NextResponse.json(
        { error: 'Can only retry failed, errored, or cancelled tasks' },
        { status: 409 }
      )
    }

    if (!task.repositoryId && task.project.repositories.length === 0) {
      return NextResponse.json(
        { error: 'No GitHub repo configured for this project' },
        { status: 422 }
      )
    }

    // Clear error/sandbox (no status change — executeAgent handles FAILED/ERROR/CANCELLED → RUNNING)
    await prisma.task.update({
      where: { id: taskId },
      data: { agentError: null, sandboxId: null },
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
