import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { agentRepository } from '@/lib/repositories/agent.repository'
import { pushAgentEvent } from '@/lib/integrations/pusher'
import { transitionAgentStatus, userFriendlyError } from '@/lib/services'
import { notifyAgentFailed } from '@/lib/services/notification.service'

/**
 * POST /api/webhooks/sandbox
 *
 * Receives E2B sandbox lifecycle events. Acts as a safety net for cases
 * where the Vercel function (waitUntil) times out before the agent can
 * complete — the sandbox eventually gets killed by E2B, and this webhook
 * catches that event to clean up stuck WORKING runs.
 *
 * @see https://e2b.dev/docs/sandbox/lifecycle-events-webhooks
 */
export async function POST(request: NextRequest) {
  const body = await request.text()
  const secret = process.env.E2B_SIGNATURE

  // Verify signature: SHA256(secret + body) → base64 (strip trailing =)
  if (secret) {
    const sig = request.headers.get('e2b-signature')
    const expected = crypto
      .createHash('sha256')
      .update(secret + body)
      .digest('base64')
      .replace(/=+$/, '')

    if (sig !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = payload.type as string | undefined
  const sandboxId = payload.sandboxId as string | undefined

  if (!eventType || !sandboxId) {
    return NextResponse.json({ ok: true, skipped: 'missing fields' })
  }

  // Only handle sandbox killed events
  if (eventType !== 'sandbox.lifecycle.killed') {
    return NextResponse.json({ ok: true, skipped: 'unhandled event' })
  }

  try {
    await handleSandboxKilled(sandboxId)
  } catch (err) {
    console.error(`[webhook/sandbox] error handling ${eventType}:`, err)
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
  const run = await agentRepository.findRunBySandboxId(sandboxId)

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
  await agentRepository.updateRun(run.id, {
    status: 'FAILED',
    errorCode,
    errorMessage: userFriendlyError(errorCode),
    finishedAt: new Date(),
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
