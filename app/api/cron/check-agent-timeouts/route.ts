import { NextRequest, NextResponse } from 'next/server'
import { agentService } from '@/lib/services/agent.service'
import { Sandbox } from '@e2b/code-interpreter'

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

  const timedOutTasks = await agentService.findTimedOutTasks()

  const results = await Promise.allSettled(
    timedOutTasks.map(async task => {
      const activeRun = await agentService.timeoutTask(task.id, task.projectId)

      // Kill E2B sandbox if one exists
      if (activeRun?.sandboxId) {
        try {
          const sandbox = await Sandbox.connect(activeRun.sandboxId)
          await sandbox.kill()
        } catch {
          // Sandbox may have already exited
        }
      }
    })
  )

  const failed = results.filter(r => r.status === 'rejected').length

  return NextResponse.json({
    processed: timedOutTasks.length,
    failed,
  })
}
