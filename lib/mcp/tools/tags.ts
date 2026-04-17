import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '@/lib/mcp/auth'
import { requireWorkspace } from '@/lib/mcp/auth'
import { tagService } from '@/lib/services/tag.service'

type CtxProvider = () => Promise<ToolContext>

// ── Handlers (exported for unit testing) ────────────────────────────────────

export function makeTagHandlers(ctxProvider: CtxProvider) {
  return {
    async list_tags() {
      const ctx = await ctxProvider()
      requireWorkspace(ctx)
      const tags = await tagService.listTags(ctx.workspaceId)
      return { tags }
    },
  }
}

// ── Registration (wires handlers into an McpServer) ─────────────────────────

export function registerTagTools(server: McpServer): void {
  server.registerTool(
    'list_tags',
    {
      description: 'List all tags defined in the active workspace.',
      inputSchema: {},
    },

    async (_args: unknown, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeTagHandlers(async () => ctx)
      const result = await h.list_tags()
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      }
    }
  )
}
