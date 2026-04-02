import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { pushAgentEvent } from '@/lib/pusher/server'
import { transitionAgentStatus } from '@/lib/agent/state-machine'
import { notifyAgentFailed } from '@/lib/notifications/notifyAgentActions'
import { userFriendlyError } from '@/lib/agent/errors'

/**
 * POST /api/webhooks/sandbox
 *
 * Receives E2B sandbox lifecycle events. Acts as a safety net for cases
 * where the Vercel function (waitUntil) times out before the agent can
 * complete — the sandbox eventually gets killed by E2B, and this webhook
 * catches that event to clean up stuck WORKING runs.
 *
 * Event: SANDBOX.LIFECYCLE.KILLED
 * Payload: { event: string, sandboxId: string, timestamp: string, ... }
 */
export async function POST(request: NextRequest) {
  // Verify webhook authenticity via shared secret
  const authHeader = request.headers.get('x-e2b-signature')
  const webhookSecret = process.env.E2B_WEBHOOK_SECRET

  if (webhookSecret && authHeader !== webhookSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = payload.event as string | undefined
  const sandboxId = payload.sandboxId as string | undefined

  if (!event || !sandboxId) {
    return NextResponse.json({ ok: true, skipped: 'missing fields' })
  }

  // Only handle sandbox killed events
  if (event !== 'SANDBOX.LIFECYCLE.KILLED') {
    return NextResponse.json({ ok: true, skipped: 'unhandled event' })
  }

  try {
    await handleSandboxKilled(sandboxId)
  } catch (err) {
    console.error(`[webhook/sandbox] error handling ${event}:`, err)
    // Return 200 to prevent E2B retrying indefinitely
  }

  return NextResponse.json({ ok: true })
}

/**
 * When a sandbox is killed, check if its AgentRun is still in a
 * running state. If so, the Vercel function died before the agent
 * could finish — mark it as failed so the user isn't stuck.
 */
async function handleSandboxKilled(sandboxId: string) {
  // Find the AgentRun that used this sandbox
  const run = await prisma.agentRun.findFirst({
    where: { sandboxId },
    select: {
      id: true,
      status: true,
      task: {
        select: {
          id: true,
          projectId: true,
          agentStatus: true,
        },
      },
    },
  })

  if (!run) {
    console.log(
      `[webhook/sandbox] No AgentRun found for sandbox ${sandboxId}, ignoring`
    )
    return
  }

  // If the run already completed/failed/cancelled, nothing to do
  if (run.status !== 'WORKING') {
    console.log(
      `[webhook/sandbox] AgentRun ${run.id} already ${run.status}, ignoring`
    )
    return
  }

  const { task } = run
  const errorCode = 'SANDBOX_KILLED'

  console.error(
    `[webhook/sandbox] Sandbox ${sandboxId} killed while AgentRun ${run.id} ` +
      `still WORKING — marking task ${task.id} as failed`
  )

  // Update AgentRun
  await prisma.agentRun.update({
    where: { id: run.id },
    data: {
      status: 'FAILED',
      errorCode,
      errorMessage: userFriendlyError(errorCode),
      finishedAt: new Date(),
    },
  })

  // Transition task status if still WORKING
  if (task.agentStatus === 'WORKING') {
    await transitionAgentStatus(task.id, task.projectId, 'FAILED', {
      agentError: errorCode,
    })
    await pushAgentEvent(task.id, {
      type: 'agent:failed',
      error: userFriendlyError(errorCode),
    })
    await notifyAgentFailed(task.id)
  }
}
