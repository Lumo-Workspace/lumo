import { mcpConnectionRepository } from '@/lib/repositories/mcp-connection.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import type { ToolContext, WorkspaceRole } from './auth'

export interface ResolveLumoContextInput {
  clerkUserId: string
  clientId: string
  clientName: string | null
}

export async function resolveLumoContext(
  input: ResolveLumoContextInput
): Promise<ToolContext> {
  const connection = await mcpConnectionRepository.upsertOnConnect(input)
  const memberships = await memberRepository.findByClerkId(input.clerkUserId)

  const bound = connection.activeWorkspaceId
    ? memberships.find(m => m.workspaceId === connection.activeWorkspaceId)
    : undefined

  if (bound) {
    return buildCtx(input.clerkUserId, connection.id, bound)
  }

  if (memberships.length === 1) {
    const sole = memberships[0]!
    await mcpConnectionRepository.setActiveWorkspace(
      connection.id,
      sole.workspaceId,
      { auto: true }
    )
    return buildCtx(input.clerkUserId, connection.id, sole)
  }

  return {
    clerkUserId: input.clerkUserId,
    connectionId: connection.id,
  }
}

function buildCtx(
  clerkUserId: string,
  connectionId: string,
  membership: { id: string; workspaceId: string; role: string }
): ToolContext {
  return {
    clerkUserId,
    connectionId,
    workspaceId: membership.workspaceId,
    memberId: membership.id,
    memberRole: membership.role as WorkspaceRole,
  }
}
