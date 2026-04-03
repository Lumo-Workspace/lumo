import { NextRequest, NextResponse } from 'next/server'
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

    if (task.agentStatus !== 'FAILED' && task.agentStatus !== 'CANCELED') {
      return NextResponse.json(
        { error: 'Can only retry failed or canceled tasks' },
        { status: 409 }
      )
    }

    if (!task.repositoryId && task.project.repositories.length === 0) {
      return NextResponse.json(
        { error: 'No GitHub repo configured for this project' },
        { status: 422 }
      )
    }

    // Clear error (no status change — executeAgent handles FAILED/CANCELED → WORKING)
    await prisma.task.update({
      where: { id: taskId },
      data: { agentError: null },
    })

    const result = await executeAgent({
      taskId,
      actorClerkId: userId,
      trigger: 'retry',
    }).catch(err => {
      console.error(`[agent/retry] Task ${taskId} failed:`, err)
      return { outcome: 'failed' as const, error: String(err) }
    })

    return NextResponse.json(
      { status: result.outcome, taskId },
      { status: 202 }
    )
  } catch (error) {
    console.error('[agent/retry] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
