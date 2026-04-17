import { mcpConnectionRepository } from '@/lib/repositories/mcp-connection.repository'
import { memberRepository } from '@/lib/repositories/member.repository'

export interface RegisterOrTouchInput {
  clerkUserId: string
  clientId: string
  clientName: string | null
}

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status })
}

export const mcpConnectionService = {
  registerOrTouch(input: RegisterOrTouchInput) {
    return mcpConnectionRepository.upsertOnConnect(input)
  },

  async bindWorkspace(
    connectionId: string,
    clerkUserId: string,
    workspaceId: string,
    opts: { auto: boolean }
  ) {
    const memberships = await memberRepository.findByClerkId(clerkUserId)
    const match = memberships.find(m => m.workspaceId === workspaceId)
    if (!match) {
      throw httpError(403, `Not a member of workspace ${workspaceId}`)
    }
    return mcpConnectionRepository.setActiveWorkspace(
      connectionId,
      workspaceId,
      opts
    )
  },

  listConnections(clerkUserId: string) {
    return mcpConnectionRepository.listActiveByClerkUser(clerkUserId)
  },

  async disconnect(connectionId: string, clerkUserId: string) {
    const existing = await mcpConnectionRepository.findById(connectionId)
    if (!existing || existing.clerkUserId !== clerkUserId) {
      throw httpError(404, 'Connection not found')
    }
    return mcpConnectionRepository.revoke(connectionId)
  },
}
