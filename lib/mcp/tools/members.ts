import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '@/lib/mcp/auth'
import { requireWorkspace } from '@/lib/mcp/auth'
import { memberService } from '@/lib/services/member.service'

type CtxProvider = () => Promise<ToolContext>

// Shape returned to MCP clients — excludes clerkId per spec.
function publicMemberShape(m: {
  id: string
  workspaceId: string
  role: string
  joinedAt?: Date
  actor?: { id: string } | null
}) {
  return {
    id: m.id,
    workspaceId: m.workspaceId,
    role: m.role,
    joinedAt: m.joinedAt ?? null,
    actorId: m.actor?.id ?? null,
  }
}

// ── Handlers (exported for unit testing) ────────────────────────────────────

export function makeMemberHandlers(ctxProvider: CtxProvider) {
  return {
    async list_members() {
      const ctx = await ctxProvider()
      requireWorkspace(ctx)
      const members = await memberService.listMembers(ctx.workspaceId)
      return { members: members.map(publicMemberShape) }
    },

    async get_member(args: { memberId: string }) {
      const ctx = await ctxProvider()
      requireWorkspace(ctx)
      const member = await memberService.getMember(
        args.memberId,
        ctx.workspaceId
      )
      return { member: publicMemberShape(member) }
    },
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerMemberTools(server: McpServer): void {
  server.registerTool(
    'list_members',
    {
      description: 'List all members of the active workspace.',
      inputSchema: {},
    },

    async (_args: unknown, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeMemberHandlers(async () => ctx)
      const result = await h.list_members()
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      }
    }
  )

  server.registerTool(
    'get_member',
    {
      description: 'Get a member of the active workspace by ID.',
      inputSchema: { memberId: z.string().describe('WorkspaceMember ID') },
    },

    async (args, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeMemberHandlers(async () => ctx)
      const result = await h.get_member(args)
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      }
    }
  )
}
