import { logger } from '@/lib/logger'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { agentRepository } from '@/lib/repositories/agent.repository'
import { processAgentCompletion } from '@/lib/services'

const bodySchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  exitCode: z.number(),
  timedOut: z.boolean(),
  stderr: z.string(),
  branchExistsOnRemote: z.boolean(),
  resultLine: z.string().optional(),
})

/**
 * POST /api/agent/sandbox-done
 *
 * Called by the E2B sandbox when the Claude CLI finishes.
 * Authenticates via the per-run mcpToken, then triggers post-processing
 * (verify push, collect metadata, create PR, update statuses).
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      console.error(
        '[agent/sandbox-done] Invalid payload:',
        parsed.error.issues
      )
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    // Verify mcpToken matches the run
    const run = await agentRepository.findRunById(parsed.data.runId)
    if (!run || run.mcpToken !== token) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 403 })
    }

    // Ignore duplicate callbacks (run already finished)
    if (run.status !== 'WORKING') {
      logger.warn(
        `[agent/sandbox-done] Run ${parsed.data.runId} already in status ${run.status}, ignoring`
      )
      return NextResponse.json({ status: 'already_finished' })
    }

    await processAgentCompletion(parsed.data)

    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    console.error('[agent/sandbox-done] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
