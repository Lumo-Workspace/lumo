import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { z } from 'zod'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { executeAgent } from '@/lib/agent/execute'

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
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }
    const { taskId, spec } = parsed.data

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

    if (task.agentStatus !== 'SPEC_REVIEW') {
      return NextResponse.json(
        { error: 'Task is not awaiting spec confirmation' },
        { status: 409 }
      )
    }

    // Save confirmed spec, reset status so execute.ts proceeds
    await prisma.task.update({
      where: { id: taskId },
      data: { spec, agentStatus: null, agentError: null },
    })

    waitUntil(
      executeAgent({ taskId, actorClerkId: userId }).catch(err => {
        console.error(`[agent/confirm-spec] Task ${taskId} failed:`, err)
      })
    )

    return NextResponse.json({ status: 'running', taskId })
  } catch (error) {
    console.error('[agent/confirm-spec] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
