import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { notificationService } from '@/lib/services/notification.service'
import {
  handleClarifyResponse,
  handleAuthorizeResponse,
  handleVerifyResponse,
} from '@/lib/services/notification-response.service'

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

    const base = {
      notificationId: id,
      actorClerkId: userId,
      workspaceId: ws.workspaceId,
      taskId,
      notification,
    }

    // ── Dispatch to service handlers ───────────────────────────────────────
    if (notification.type === 'AGENT_CLARIFY') {
      if (data.action !== 'reply') {
        return NextResponse.json(
          { error: 'AGENT_CLARIFY only supports action=reply' },
          { status: 400 }
        )
      }
      const result = await handleClarifyResponse({ ...base, reply: data.reply })
      return NextResponse.json(result)
    }

    if (notification.type === 'AGENT_AUTHORIZE') {
      if (data.action !== 'approve' && data.action !== 'deny') {
        return NextResponse.json(
          { error: 'AGENT_AUTHORIZE supports action=approve or action=deny' },
          { status: 400 }
        )
      }
      const result = await handleAuthorizeResponse({
        ...base,
        action: data.action,
      })
      return NextResponse.json(result)
    }

    if (notification.type === 'AGENT_VERIFY') {
      if (data.action !== 'confirm' && data.action !== 'send_back') {
        return NextResponse.json(
          { error: 'AGENT_VERIFY supports action=confirm or action=send_back' },
          { status: 400 }
        )
      }
      const result = await handleVerifyResponse({
        ...base,
        action: data.action,
      })
      return NextResponse.json(result)
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
