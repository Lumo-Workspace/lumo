// lib/mcp/tools/index.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerWorkspaceTools } from './workspace'
import { registerProjectTools } from './projects'
import { registerMemberTools } from './members'

export function registerAllTools(server: McpServer): void {
  // Always exposed (bootstrap)
  registerWorkspaceTools(server)

  // Domain tools — each handler calls requireWorkspace(ctx) and throws
  // WORKSPACE_REQUIRED when a workspace has not yet been bound.
  registerProjectTools(server)
  registerMemberTools(server)
}
