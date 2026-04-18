import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '@/lib/mcp/auth'
import { requireWorkspace } from '@/lib/mcp/auth'
import { documentService } from '@/lib/services/document.service'

type CtxProvider = () => Promise<ToolContext>

// ── Handlers (exported for unit testing) ────────────────────────────────────

export function makeDocumentHandlers(ctxProvider: CtxProvider) {
  return {
    async list_documents() {
      const ctx = await ctxProvider()
      requireWorkspace(ctx)
      const documents = await documentService.listDocuments(
        ctx.workspaceId,
        ctx.memberId
      )
      return { documents }
    },

    async get_document(args: { documentId: string }) {
      const ctx = await ctxProvider()
      requireWorkspace(ctx)
      const document = await documentService.getDocument(
        args.documentId,
        ctx.memberId,
        ctx.workspaceId
      )
      return { document }
    },
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerDocumentTools(server: McpServer): void {
  server.registerTool(
    'list_documents',
    {
      description:
        'List documents in the active workspace visible to the current user.',
      inputSchema: {},
    },

    async (_args: unknown, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeDocumentHandlers(async () => ctx)
      const result = await h.list_documents()
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      }
    }
  )

  server.registerTool(
    'get_document',
    {
      description:
        'Get a document by ID. Returns 404 if you do not have access.',
      inputSchema: { documentId: z.string().describe('Document ID') },
    },

    async (args, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeDocumentHandlers(async () => ctx)
      const result = await h.get_document(args)
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      }
    }
  )
}
