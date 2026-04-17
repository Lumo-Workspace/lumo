import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '@/lib/mcp/auth'
import { requireWorkspace } from '@/lib/mcp/auth'
import { projectService } from '@/lib/services/project.service'

type CtxProvider = () => Promise<ToolContext>

// ── Handlers (exported for unit testing) ────────────────────────────────────

export function makeProjectHandlers(ctxProvider: CtxProvider) {
  return {
    async list_projects() {
      const ctx = await ctxProvider()
      requireWorkspace(ctx)
      const projects = await projectService.listProjects(
        ctx.workspaceId,
        ctx.memberId
      )
      return { projects }
    },

    async get_project(args: { projectId: string }) {
      const ctx = await ctxProvider()
      requireWorkspace(ctx)
      const project = await projectService.getProject(
        args.projectId,
        ctx.memberId
      )
      return { project }
    },
  }
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerProjectTools(server: McpServer): void {
  server.registerTool(
    'list_projects',
    {
      description:
        'List all projects in the active workspace visible to the current user.',
      inputSchema: {},
    },

    async (_args: unknown, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeProjectHandlers(async () => ctx)
      const result = await h.list_projects()
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      }
    }
  )

  server.registerTool(
    'get_project',
    {
      description: 'Get a single project by ID.',
      inputSchema: { projectId: z.string().describe('Project ID') },
    },

    async (args, extra: any) => {
      const ctx = extra.ctx as ToolContext
      const h = makeProjectHandlers(async () => ctx)
      const result = await h.get_project(args)
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
      }
    }
  )
}
