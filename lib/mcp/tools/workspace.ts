import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '@/lib/mcp/auth'
import { memberRepository } from '@/lib/repositories/member.repository'
import { mcpConnectionService } from '@/lib/services/mcp-connection.service'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { McpError, McpErrorCode } from '@/lib/mcp/errors'

type CtxProvider = () => Promise<ToolContext>

// ── Handlers (exported for unit testing) ────────────────────────────────────

export function makeWorkspaceHandlers(ctxProvider: CtxProvider) {
  return {
    async list_my_workspaces() {
      const ctx = await ctxProvider()
      const memberships = await memberRepository.findByClerkId(ctx.clerkUserId)
      return memberships.map(m => ({
        workspaceId: m.workspaceId,
        name: m.workspace?.name ?? null,
        slug: m.workspace?.slug ?? null,
        role: m.role,
      }))
    },

    async select_workspace(args: { workspaceId: string }) {
      const ctx = await ctxProvider()
      const updated = await mcpConnectionService.bindWorkspace(
        ctx.connectionId,
        ctx.clerkUserId,
        args.workspaceId,
        { auto: false }
      )
      return {
        activeWorkspaceId: updated.activeWorkspaceId,
        note: 'Workspace bound — re-list tools to see the full set.',
      }
    },

    async get_active_workspace() {
      const ctx = await ctxProvider()
      if (!ctx.workspaceId) {
        return { activeWorkspaceId: null, note: 'Bootstrap mode — call select_workspace.' }
      }
      const ws = await workspaceRepository.findById(ctx.workspaceId)
      if (!ws) {
        throw new McpError(McpErrorCode.ResourceNotFound, 'Active workspace not found')
      }
      return { activeWorkspaceId: ws.id, name: ws.name, slug: ws.slug, memberRole: ctx.memberRole }
    },
  }
}

// ── Registration (wires handlers into an McpServer) ─────────────────────────

export function registerWorkspaceTools(server: McpServer) {
  server.registerTool(
    'list_my_workspaces',
    {
      description: 'List all workspaces the current user belongs to.',
      inputSchema: {},
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_args: unknown, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeWorkspaceHandlers(async () => ctx)
      const result = await h.list_my_workspaces()
      return { content: [{ type: 'text' as const, text: JSON.stringify({ workspaces: result }, null, 2) }] }
    }
  )

  server.registerTool(
    'select_workspace',
    {
      description:
        'Bind this MCP connection to a workspace. Required before calling most tools when you have multiple workspaces.',
      inputSchema: {
        workspaceId: z.string().describe('Workspace ID (from list_my_workspaces)'),
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeWorkspaceHandlers(async () => ctx)
      const result = await h.select_workspace(args)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    }
  )

  server.registerTool(
    'get_active_workspace',
    {
      description: 'Return the currently-bound workspace for this connection.',
      inputSchema: {},
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (_args: unknown, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeWorkspaceHandlers(async () => ctx)
      const result = await h.get_active_workspace()
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    }
  )
}
