/**
 * MCP runtime context — sourced from env vars set in mcp.json.
 *
 * MCP_WORKSPACE_ID  — the workspace to operate on
 * MCP_MEMBER_ID     — WorkspaceMember.id of the authenticated user ("me")
 */

export function getContext() {
  const workspaceId = process.env.MCP_WORKSPACE_ID
  const memberId = process.env.MCP_MEMBER_ID

  if (!workspaceId || !memberId) {
    throw new Error(
      'MCP_WORKSPACE_ID and MCP_MEMBER_ID must be set in mcp.json env'
    )
  }

  return { workspaceId, memberId }
}

/**
 * Resolve assigneeId: supports the "me" shortcut.
 */
export function resolveAssignee(
  assigneeId: string | undefined,
  memberId: string
): string | undefined {
  if (!assigneeId) return undefined
  return assigneeId === 'me' ? memberId : assigneeId
}
