import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { resumeAgent } from '@/lib/agent/resume'
import {
  clearAgentStatus,
  transitionAgentStatus,
} from '@/lib/agent/state-machine'
import { transitionTaskStatus } from '@/lib/task/state-machine'
import { executeAgent } from '@/lib/agent/execute'

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

    // Load notification
    const notification = await prisma.notification.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        requiresAction: true,
        actionTakenAt: true,
        recipientActorId: true,
        taskId: true,
        clarifyId: true,
      },
    })

    if (!notification) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    if (notification.recipientActorId !== recipientActorId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!notification.requiresAction) {
      return NextResponse.json(
        { error: 'This notification does not require an action' },
        { status: 409 }
      )
    }
    if (notification.actionTakenAt) {
      return NextResponse.json(
        { error: 'Action already taken' },
        { status: 409 }
      )
    }

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

    const taskId = notification.taskId
    if (!taskId) {
      return NextResponse.json({ error: 'No task linked' }, { status: 422 })
    }

    // ── AGENT_CLARIFY ──────────────────────────────────────────────────────────
    if (notification.type === 'AGENT_CLARIFY') {
      if (data.action !== 'reply') {
        return NextResponse.json(
          { error: 'AGENT_CLARIFY only supports action=reply' },
          { status: 400 }
        )
      }

      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          agentStatus: true,
          sandboxId: true,
          projectId: true,
          project: { select: { workspaceId: true } },
        },
      })

      if (!task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      }
      if (task.project.workspaceId !== ws.workspaceId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      // Mark actionTakenAt first to prevent double-submission
      await prisma.notification.update({
        where: { id },
        data: { actionTakenAt: new Date(), read: true },
      })

      if (task.agentStatus === 'PAUSED' && task.sandboxId) {
        // Sandbox still alive — resume in-place
        try {
          await resumeAgent(taskId, task.projectId, task.sandboxId, data.reply)
        } catch {
          // Sandbox expired — fall through to re-run
          await prisma.task.update({
            where: { id: taskId },
            data: { agentError: null, sandboxId: null },
          })
          // Record clarify reply in DB before re-run
          if (notification.clarifyId) {
            await prisma.agentClarify.update({
              where: { id: notification.clarifyId },
              data: { reply: data.reply, repliedAt: new Date() },
            })
          }
          waitUntil(
            executeAgent({ taskId, actorClerkId: userId }).catch(err => {
              console.error(`[notifications/respond] Re-run failed:`, err)
            })
          )
        }
      } else {
        // Sandbox expired or task not PAUSED — re-run the agent fresh
        await prisma.task.update({
          where: { id: taskId },
          data: { agentError: null, sandboxId: null },
        })
        if (notification.clarifyId) {
          await prisma.agentClarify.update({
            where: { id: notification.clarifyId },
            data: { reply: data.reply, repliedAt: new Date() },
          })
        }
        waitUntil(
          executeAgent({ taskId, actorClerkId: userId }).catch(err => {
            console.error(`[notifications/respond] Re-run failed:`, err)
          })
        )
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

      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          agentStatus: true,
          sandboxId: true,
          projectId: true,
          project: { select: { workspaceId: true } },
        },
      })

      if (!task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      }
      if (task.project.workspaceId !== ws.workspaceId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      await prisma.notification.update({
        where: { id },
        data: { actionTakenAt: new Date(), read: true },
      })

      if (data.action === 'approve') {
        // Write approval to sandbox so the agent can continue
        const reply = 'APPROVED'
        if (task.agentStatus === 'PAUSED' && task.sandboxId) {
          try {
            await resumeAgent(taskId, task.projectId, task.sandboxId, reply)
          } catch {
            await prisma.task.update({
              where: { id: taskId },
              data: { agentError: null, sandboxId: null },
            })
            waitUntil(
              executeAgent({ taskId, actorClerkId: userId }).catch(err => {
                console.error(
                  `[notifications/respond] Approve re-run failed:`,
                  err
                )
              })
            )
          }
        } else {
          await prisma.task.update({
            where: { id: taskId },
            data: { agentError: null, sandboxId: null },
          })
          waitUntil(
            executeAgent({ taskId, actorClerkId: userId }).catch(err => {
              console.error(
                `[notifications/respond] Approve re-run failed:`,
                err
              )
            })
          )
        }
      } else {
        // Deny: fail the agent
        await transitionAgentStatus(taskId, task.projectId, 'FAILED', {
          agentError: 'AUTHORIZATION_DENIED',
          sandboxId: null,
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

      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          status: true,
          agentStatus: true,
          projectId: true,
          project: { select: { workspaceId: true } },
        },
      })

      if (!task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      }
      if (task.project.workspaceId !== ws.workspaceId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      // Mark actionTakenAt first
      await prisma.notification.update({
        where: { id },
        data: { actionTakenAt: new Date(), read: true },
      })

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
        await prisma.task.update({
          where: { id: taskId },
          data: { agentError: null, sandboxId: null },
        })
        waitUntil(
          executeAgent({ taskId, actorClerkId: userId }).catch(err => {
            console.error(
              `[notifications/respond] Send-back re-run failed:`,
              err
            )
          })
        )
      }

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json(
      { error: `Notification type ${notification.type} is not actionable` },
      { status: 409 }
    )
  } catch (error) {
    console.error('POST /api/notifications/[id]/respond error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
