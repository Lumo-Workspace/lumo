import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { pushAgentEvent } from '@/lib/pusher/server'
import { transitionAgentStatus } from '@/lib/agent/state-machine'
import { Sandbox } from '@e2b/code-interpreter'

const CLARIFY_TIMEOUT_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * GET /api/cron/check-agent-timeouts
 * Called hourly by Vercel Cron. Marks tasks paused >24h as failed.
 */
export async function GET(req: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - CLARIFY_TIMEOUT_MS)

  const timedOutTasks = await prisma.task.findMany({
    where: {
      agentStatus: 'INPUT_REQUIRED',
      updatedAt: { lt: cutoff },
    },
    select: { id: true, projectId: true },
  })

  const results = await Promise.allSettled(
    timedOutTasks.map(async task => {
      // Find active AgentRun and kill its sandbox
      const activeRun = await prisma.agentRun.findFirst({
        where: { taskId: task.id, status: 'WORKING' },
        select: { id: true, sandboxId: true },
      })

      if (activeRun?.sandboxId) {
        try {
          const sandbox = await Sandbox.connect(activeRun.sandboxId)
          await sandbox.kill()
        } catch {
          // Sandbox may have already exited
        }
      }

      await transitionAgentStatus(task.id, task.projectId, 'FAILED', {
        agentError: 'CLARIFY_TIMEOUT',
        currentStatus: 'INPUT_REQUIRED',
      })
      if (activeRun) {
        await prisma.agentRun.update({
          where: { id: activeRun.id },
          data: {
            status: 'FAILED',
            errorCode: 'CLARIFY_TIMEOUT',
            errorMessage:
              'Agent was waiting for clarification for 24 hours and has been stopped.',
            finishedAt: new Date(),
          },
        })
      }

      await pushAgentEvent(task.id, {
        type: 'agent:failed',
        error:
          'Agent was waiting for clarification for 24 hours and has been stopped. Add more details to the spec and retry.',
      })
    })
  )

  const failed = results.filter(r => r.status === 'rejected').length

  return NextResponse.json({
    processed: timedOutTasks.length,
    failed,
  })
}
