import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { zodError, requireTaskMember } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'
import { executeAgent } from '@/lib/agent/execute'

// Fluid Compute on Pro plan: up to 800s
export const maxDuration = 800

const bodySchema = z.object({
  taskId: z.string().min(1),
})

/**
 * POST /api/agent/execute
 * Triggers the Lumo coding agent for a task.
 * The agent runs inside the request handler (up to maxDuration=300s).
 * Real-time progress is delivered via Pusher; the HTTP response
 * returns only after the agent finishes.
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

    // Load task and look up its workspace
    const rawTask = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        agentStatus: true,
        repositoryId: true,
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

    const hasRepo = task.repositoryId || task.project.repositories.length > 0
    if (!hasRepo) {
      return NextResponse.json(
        { error: 'No GitHub repo configured for this project' },
        { status: 422 }
      )
    }

    // Prevent double-execution
    if (task.agentStatus === 'WORKING') {
      return NextResponse.json(
        { error: 'Agent is already running for this task' },
        { status: 409 }
      )
    }

    // Run agent in the request handler so maxDuration=300 applies.
    // (waitUntil has a 60s hard limit on Pro plan, too short for agent runs)
    const result = await executeAgent({
      taskId,
      actorClerkId: userId,
      trigger: 'initial',
    }).catch(err => {
      console.error(`[agent/execute] Task ${taskId} failed:`, err)
      return { outcome: 'failed' as const, error: String(err) }
    })

    return NextResponse.json({ status: result.outcome, taskId })
  } catch (error) {
    console.error('[agent/execute] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
