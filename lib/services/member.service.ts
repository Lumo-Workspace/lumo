import { memberRepository } from '@/lib/repositories/member.repository'
import { DEFAULT_AGENT_AVATAR_COLOR } from '@/lib/constants/avatar'
import type { WorkspaceRole } from '@prisma/client'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'

// ── Member Service ─────────────────────────────────────────────────────────

export const memberService = {
  /**
   * List all workspace members (raw DB records with actor IDs).
   * Caller is responsible for enriching with Clerk user profiles.
   */
  async listMembers(workspaceId: string) {
    return memberRepository.findByWorkspace(workspaceId)
  },

  /**
   * Get a single workspace member by ID, scoped to workspaceId.
   * Throws 404 if the member does not exist or belongs to a different workspace.
   */
  async getMember(memberId: string, workspaceId: string) {
    const member = await memberRepository.findById(memberId)
    if (!member || member.workspaceId !== workspaceId) {
      throw Object.assign(new Error('Member not found'), { status: 404 })
    }
    return member
  },

  /** Get agent actors for a workspace, lazy-creating the coding agent if needed. */
  async getAgentActors(workspaceId: string) {
    const existingAgent =
      await memberRepository.findCodingAgentProfile(workspaceId)
    if (!existingAgent) {
      await memberRepository.createCodingAgent(workspaceId)
    }

    const agentActors = await memberRepository.findAgentActors(workspaceId)
    return agentActors.map(a => ({
      actorId: a.id,
      name: a.agent?.name ?? 'Agent',
      avatarColor: a.agent?.avatarColor ?? DEFAULT_AGENT_AVATAR_COLOR,
      type: a.agent?.type ?? 'CODING',
    }))
  },

  /** Update a member's role. Only OWNER callers can do this. */
  async updateMemberRole(
    memberId: string,
    newRole: WorkspaceRole,
    callerMemberId: string,
    callerRole: string,
    callerWorkspaceId: string,
    audit?: AuditContext
  ) {
    if (callerRole !== 'OWNER') {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }

    if (memberId === callerMemberId) {
      throw Object.assign(new Error('You cannot change your own role'), {
        status: 400,
      })
    }

    const target = await memberRepository.findById(memberId)
    if (!target || target.workspaceId !== callerWorkspaceId) {
      throw Object.assign(new Error('Member not found'), { status: 404 })
    }

    // Guard: cannot demote the last OWNER
    if (target.role === 'OWNER' && newRole === 'MEMBER') {
      const ownerCount = await memberRepository.countOwners(callerWorkspaceId)
      if (ownerCount <= 1) {
        throw Object.assign(new Error('Cannot remove the last admin'), {
          status: 400,
        })
      }
    }

    const updated = await memberRepository.updateRole(memberId, newRole)
    await recordAuditEvent({
      workspaceId: callerWorkspaceId,
      action: 'member.role_changed',
      target: { type: 'member', id: memberId },
      metadata: { from: target.role, to: newRole },
      context: audit,
    })
    return updated
  },

  /** Remove the current user from the workspace. Blocked if last OWNER. */
  async leaveWorkspace(
    memberId: string,
    memberRole: string,
    workspaceId: string,
    audit?: AuditContext
  ) {
    if (memberRole === 'OWNER') {
      const ownerCount = await memberRepository.countOwners(workspaceId)
      if (ownerCount <= 1) {
        throw Object.assign(
          new Error(
            'Cannot leave — you are the last admin. Transfer admin to someone else first.'
          ),
          { status: 400 }
        )
      }
    }

    await memberRepository.delete(memberId)
    await recordAuditEvent({
      workspaceId,
      action: 'member.left',
      target: { type: 'member', id: memberId },
      metadata: { role: memberRole },
      context: audit,
    })
  },
}
