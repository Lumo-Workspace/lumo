// lib/mcp/tools/index.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from '@/lib/mcp/auth'
import { registerWorkspaceTools } from './workspace'

export type CtxProvider = () => Promise<ToolContext>

export function registerAllTools(server: McpServer, ctxProvider: CtxProvider) {
  // Always exposed
  registerWorkspaceTools(server, ctxProvider)

  // Additional tools registered only when a workspace is bound.
  // Phase 3 and 4 will add domain tools here, guarded by a check.
}
