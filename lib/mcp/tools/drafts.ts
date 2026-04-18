import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '@/lib/mcp/auth'
import { requireWorkspace } from '@/lib/mcp/auth'
import { draftService } from '@/lib/services/draft.service'
import { memberRepository } from '@/lib/repositories/member.repository'

type CtxProvider = () => Promise<ToolContext>

// ── Handlers (exported for unit testing) ────────────────────────────────────

export function makeDraftHandlers(ctxProvider: CtxProvider) {
  return {
    async list_my_drafts() {
      const ctx = await ctxProvider()
      requireWorkspace(ctx)
      const actor = await memberRepository.findActorByMemberId(ctx.memberId)
      if (!actor) {
        return { drafts: [] }
      }
      const drafts = await draftService.listDrafts(ctx.workspaceId, actor.id)
      return { drafts }
    },

    async get_draft(args: { draftId: string }) {
      const ctx = await ctxProvider()
      requireWorkspace(ctx)
      const actor = await memberRepository.findActorByMemberId(ctx.memberId)
      if (!actor) {
        throw Object.assign(new Error('Draft not found'), { status: 404 })
      }
      const draft = await draftService.getDraft(
        args.draftId,
        actor.id,
        ctx.workspaceId
      )
      return { draft }
    },
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerDraftTools(server: McpServer): void {
  server.registerTool(
    'list_my_drafts',
    {
      description:
        'List drafts authored by the current user in the active workspace.',
      inputSchema: {},
    },

    async (_args: unknown, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeDraftHandlers(async () => ctx)
      const result = await h.list_my_drafts()
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      }
    }
  )

  server.registerTool(
    'get_draft',
    {
      description: 'Get one of your own drafts by ID.',
      inputSchema: { draftId: z.string().describe('Draft ID') },
    },

    async (args, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeDraftHandlers(async () => ctx)
      const result = await h.get_draft(args)
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      }
    }
  )
}
