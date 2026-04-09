import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { notificationService } from '@/lib/services/notification.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import {
  resumeAgent,
  clearAgentStatus,
  transitionAgentStatus,
  executeAgent,
} from '@/lib/services'
import { transitionTaskStatus } from '@/lib/task/state-machine'
import {
  isAgentServiceEnabled,
  proxyToAgentService,
} from '@/lib/integrations/sandbox'

/** Run agent either via proxy or locally. */
async function runAgent(opts: {
  taskId: string
  actorClerkId: string
  trigger: string
}): Promise<void> {
  if (isAgentServiceEnabled()) {
    await proxyToAgentService('/api/agent/execute', opts)
  } else {
    await executeAgent(opts)
  }
}

type Params = { params: Promise<{ id: string }> }

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reply'), reply: z.string().min(1) }),
  z.object({ action: z.literal('confirm') }),
  z.object({ action: z.literal('send_back') }),
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('deny') }),
])

/**
 * POST /api/notifications/[id]/respond
 * Handle actionable notification responses:
 *   AGENT_CLARIFY   + action='reply'     → resume or restart agent with reply
 *   AGENT_AUTHORIZE + action='approve'   → mark approved, resume agent
 *   AGENT_AUTHORIZE + action='deny'      → mark denied, fail agent
 *   AGENT_VERIFY    + action='confirm'   → transition task to DONE
 *   AGENT_VERIFY    + action='send_back' → clear agent status and re-run agent
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    // Resolve workspace + actor
    const ws = await getUserWorkspace(userId)
    if (!ws) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      )
    }
    const recipientActorId = await getHumanActorId(ws.member.id)
    if (!recipientActorId) {
      return NextResponse.json({ error: 'Actor not found' }, { status: 404 })
    }

    // Load notification with ownership + action checks
    const notification = await notificationService.loadForRespond(
      id,
      recipientActorId
    )
    const taskId = notification.taskId!

    // Parse body
    const body = await request.json().catch(() => ({}))
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const data = parsed.data

    // ── AGENT_CLARIFY ──────────────────────────────────────────────────────────
    if (notification.type === 'AGENT_CLARIFY') {
      if (data.action !== 'reply') {
        return NextResponse.json(
          { error: 'AGENT_CLARIFY only supports action=reply' },
          { status: 400 }
        )
      }

      const task = await taskRepository.findForAgent(taskId)

      if (!task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      }
      if (task.project.workspaceId !== ws.workspaceId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      // Mark actionTakenAt first to prevent double-submission
      await notificationService.markActionTaken(id)

      if (task.agentStatus === 'INPUT_REQUIRED') {
        // Resume agent — DB update only, MCP server picks up reply via HTTP poll
        try {
          await resumeAgent(taskId, task.projectId, data.reply)
        } catch {
          // Resume failed — fall through to re-run
          await taskRepository.clearAgentError(taskId)
          if (notification.clarifyId) {
            await notificationService.replyClarify(
              notification.clarifyId,
              data.reply
            )
          }
          await runAgent({
            taskId,
            actorClerkId: userId,
            trigger: 'clarify_reply',
          }).catch(err => {
            console.error(`[notifications/respond] Re-run failed:`, err)
          })
        }
      } else {
        // Task not INPUT_REQUIRED — re-run the agent fresh
        await taskRepository.clearAgentError(taskId)
        if (notification.clarifyId) {
          await notificationService.replyClarify(
            notification.clarifyId,
            data.reply
          )
        }
        await executeAgent({
          taskId,
          actorClerkId: userId,
          trigger: 'clarify_reply',
        }).catch(err => {
          console.error(`[notifications/respond] Re-run failed:`, err)
        })
      }

      return NextResponse.json({ ok: true })
    }

    // ── AGENT_AUTHORIZE ────────────────────────────────────────────────────────
    if (notification.type === 'AGENT_AUTHORIZE') {
      if (data.action !== 'approve' && data.action !== 'deny') {
        return NextResponse.json(
          { error: 'AGENT_AUTHORIZE supports action=approve or action=deny' },
          { status: 400 }
        )
      }

      const task = await taskRepository.findForAgent(taskId)

      if (!task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      }
      if (task.project.workspaceId !== ws.workspaceId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      await notificationService.markActionTaken(id)

      if (data.action === 'approve') {
        const reply = 'APPROVED'
        if (task.agentStatus === 'INPUT_REQUIRED') {
          try {
            await resumeAgent(taskId, task.projectId, reply)
          } catch {
            await taskRepository.clearAgentError(taskId)
            await runAgent({
              taskId,
              actorClerkId: userId,
              trigger: 'clarify_reply',
            }).catch(err => {
              console.error(
                `[notifications/respond] Approve re-run failed:`,
                err
              )
            })
          }
        } else {
          await taskRepository.clearAgentError(taskId)
          await executeAgent({
            taskId,
            actorClerkId: userId,
            trigger: 'clarify_reply',
          }).catch(err => {
            console.error(`[notifications/respond] Approve re-run failed:`, err)
          })
        }
      } else {
        // Deny: fail the agent
        await transitionAgentStatus(taskId, task.projectId, 'FAILED', {
          agentError: 'AUTHORIZATION_DENIED',
        })
      }

      return NextResponse.json({ ok: true })
    }

    // ── AGENT_VERIFY ───────────────────────────────────────────────────────────
    if (notification.type === 'AGENT_VERIFY') {
      if (data.action !== 'confirm' && data.action !== 'send_back') {
        return NextResponse.json(
          { error: 'AGENT_VERIFY supports action=confirm or action=send_back' },
          { status: 400 }
        )
      }

      const task = await taskRepository.findForAgent(taskId)

      if (!task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      }
      if (task.project.workspaceId !== ws.workspaceId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      // Mark actionTakenAt first
      await notificationService.markActionTaken(id)

      if (data.action === 'confirm') {
        // Transition task → DONE
        await transitionTaskStatus(taskId, task.projectId, 'DONE', {
          currentStatus: task.status as
            | 'TODO'
            | 'IN_PROGRESS'
            | 'IN_REVIEW'
            | 'DONE',
        })
      } else {
        // send_back: clear agent status and re-run
        await clearAgentStatus(taskId, task.projectId)
        await taskRepository.clearAgentError(taskId)
        await runAgent({
          taskId,
          actorClerkId: userId,
          trigger: 'send_back',
        }).catch(err => {
          console.error(`[notifications/respond] Send-back re-run failed:`, err)
        })
      }

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json(
      { error: `Notification type ${notification.type} is not actionable` },
      { status: 409 }
    )
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status && status >= 400 && status < 500) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    console.error('POST /api/notifications/[id]/respond error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
