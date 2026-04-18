// lib/mcp/tools/index.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerWorkspaceTools } from './workspace'
import { registerProjectTools } from './projects'
import { registerMemberTools } from './members'
import { registerTagTools } from './tags'
import { registerDraftTools } from './drafts'
import { registerNotificationTools } from './notifications'
import { registerDocumentTools } from './documents'
import { registerCommentTools } from './comments'

export function registerAllTools(server: McpServer): void {
  // Always exposed (bootstrap)
  registerWorkspaceTools(server)

  // Domain tools — each handler calls requireWorkspace(ctx) and throws
  // WORKSPACE_REQUIRED when a workspace has not yet been bound.
  registerProjectTools(server)
  registerMemberTools(server)
  registerTagTools(server)
  registerDraftTools(server)
  registerNotificationTools(server)
  registerDocumentTools(server)
  registerCommentTools(server)
}
