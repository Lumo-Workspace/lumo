import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { prisma } from '../db.js'
import { getContext } from '../context.js'

export function registerWorkspaceTools(server: McpServer) {
  server.registerTool(
    'get_workspace_context',
    {
      description:
        'Get workspace details and member list. Call this first to orient yourself.',
    },
    async () => {
      const { workspaceId, memberId } = getContext()

      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, name: true, slug: true },
      })
      if (!workspace) throw new Error('Workspace not found')

      const members = await prisma.workspaceMember.findMany({
        where: { workspaceId },
        select: { id: true, clerkId: true, role: true },
      })

      const teams = await prisma.team.findMany({
        where: { workspaceId },
        select: { id: true, name: true, identifier: true, isDefault: true },
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              { workspace, currentMemberId: memberId, members, teams },
              null,
              2
            ),
          },
        ],
      }
    }
  )
}
