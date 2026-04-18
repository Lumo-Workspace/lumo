import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '@/lib/mcp/auth'
import { requireWorkspace } from '@/lib/mcp/auth'
import { notificationService } from '@/lib/services/notification.service'
import { memberRepository } from '@/lib/repositories/member.repository'

type CtxProvider = () => Promise<ToolContext>

// ── Handlers (exported for unit testing) ────────────────────────────────────

export function makeNotificationHandlers(ctxProvider: CtxProvider) {
  return {
    async list_notifications() {
      const ctx = await ctxProvider()
      requireWorkspace(ctx)
      const actor = await memberRepository.findActorByMemberId(ctx.memberId)
      if (!actor) {
        throw Object.assign(new Error('No actor for member'), { status: 404 })
      }
      const notifications = await notificationService.getNotifications(
        actor.id,
        ctx.workspaceId
      )
      return { notifications }
    },

    async get_notification(args: { notificationId: string }) {
      const ctx = await ctxProvider()
      requireWorkspace(ctx)
      const actor = await memberRepository.findActorByMemberId(ctx.memberId)
      if (!actor) {
        throw Object.assign(new Error('Notification not found'), {
          status: 404,
        })
      }
      const notification = await notificationService.getNotification(
        args.notificationId,
        actor.id
      )
      return { notification }
    },
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerNotificationTools(server: McpServer): void {
  server.registerTool(
    'list_notifications',
    {
      description:
        'List notifications for the current user in the active workspace.',
      inputSchema: {},
    },

    async (_args: unknown, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeNotificationHandlers(async () => ctx)
      const result = await h.list_notifications()
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      }
    }
  )

  server.registerTool(
    'get_notification',
    {
      description: 'Get a single notification by ID.',
      inputSchema: {
        notificationId: z.string().describe('Notification ID'),
      },
    },

    async (args, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeNotificationHandlers(async () => ctx)
      const result = await h.get_notification(args)
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      }
    }
  )
}
