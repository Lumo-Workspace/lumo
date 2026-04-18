import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '@/lib/mcp/auth'
import { requireWorkspace } from '@/lib/mcp/auth'
import { commentService } from '@/lib/services/comment.service'

type CtxProvider = () => Promise<ToolContext>

export function makeCommentHandlers(ctxProvider: CtxProvider) {
  return {
    async list_task_comments(args: { taskId: string }) {
      const ctx = await ctxProvider()
      requireWorkspace(ctx)
      const comments = await commentService.getComments(args.taskId)
      return { comments }
    },
  }
}

export function registerCommentTools(server: McpServer): void {
  server.registerTool(
    'list_task_comments',
    {
      description: 'List all comments on a task, ordered chronologically.',
      inputSchema: { taskId: z.string().describe('Task ID (cuid)') },
    },

    async (args, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeCommentHandlers(async () => ctx)
      const result = await h.list_task_comments(args)
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      }
    }
  )
}
