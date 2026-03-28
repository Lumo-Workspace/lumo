import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { z } from 'zod'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { executeAgent } from '@/lib/agent/execute'

const bodySchema = z.object({
  taskId: z.string().min(1),
  workspaceId: z.string().min(1),
})

/**
 * POST /api/agent/execute
 * Triggers the Lumo coding agent for a task.
 * The agent runs asynchronously via waitUntil — this route returns immediately.
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
    const { taskId, workspaceId } = parsed.data

    // Verify the caller is a member of this workspace
    const memberResult = await requireWorkspaceMember(workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    // Load task and validate it belongs to this workspace
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

    if (task.project.workspaceId !== workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!task.project.githubRepo) {
      return NextResponse.json(
        { error: 'No GitHub repo configured for this project' },
        { status: 422 }
      )
    }

    // Prevent double-execution
    if (task.agentStatus === 'running') {
      return NextResponse.json(
        { error: 'Agent is already running for this task' },
        { status: 409 }
      )
    }

    // Fire-and-forget: Vercel keeps the function alive until executeAgent resolves
    waitUntil(
      executeAgent({ taskId, actorClerkId: userId }).catch(err => {
        console.error(`[agent/execute] Task ${taskId} failed:`, err)
      })
    )

    return NextResponse.json({ status: 'started', taskId })
  } catch (error) {
    console.error('[agent/execute] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
