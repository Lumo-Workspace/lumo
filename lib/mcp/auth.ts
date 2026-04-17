import { McpError, McpErrorCode } from './errors'

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'

export interface ToolContext {
  clerkUserId: string
  connectionId: string
  workspaceId?: string
  memberId?: string
  memberRole?: WorkspaceRole
}

export function requireRole(ctx: ToolContext, allowed: WorkspaceRole[]): void {
  if (!ctx.memberRole || !allowed.includes(ctx.memberRole)) {
    throw new McpError(
      McpErrorCode.Forbidden,
      `This tool requires one of: ${allowed.join(', ')}. Current role: ${ctx.memberRole ?? 'unknown'}.`
    )
  }
}

export function requireWorkspace(ctx: ToolContext): asserts ctx is ToolContext &
  Required<Pick<ToolContext, 'workspaceId' | 'memberId' | 'memberRole'>> {
  if (!ctx.workspaceId) {
    throw Object.assign(
      new Error('No active workspace — call select_workspace first'),
      { code: 'WORKSPACE_REQUIRED' }
    )
  }
}
