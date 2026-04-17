// lib/mcp/tools/index.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerWorkspaceTools } from './workspace'

export function registerAllTools(server: McpServer): void {
  // Always exposed
  registerWorkspaceTools(server)

  // Additional tools registered only when a workspace is bound.
  // Phase 3 and 4 will add domain tools here, guarded by a check.
}
