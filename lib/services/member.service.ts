import { memberRepository } from '@/lib/repositories/member.repository'
import { DEFAULT_AGENT_AVATAR_COLOR } from '@/lib/constants/avatar'
import type { WorkspaceRole } from '@prisma/client'
import {
  recordAuditEvent,
  SYSTEM_AUDIT_CONTEXT,
  type AuditContext,
} from '@/lib/services/audit.service'
import { removeMemberIntegrations } from '@/lib/services/member-integrations.service'

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

  /**
   * Remove the current user from the workspace. Blocked if last OWNER.
   * LUM-906: deactivates the row (keys revoked first, authorship and
   * session history kept) instead of deleting it — a delete failed with a
   * 500 for anyone who had created a project or document.
   */
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

    // Personal integration credentials first (idempotent), then the row.
    await removeMemberIntegrations(
      workspaceId,
      memberId,
      audit ?? SYSTEM_AUDIT_CONTEXT
    )
    const { deactivated, apiKeysRevoked } = await memberRepository.deactivate(
      memberId,
      'LEFT'
    )
    if (!deactivated) return // already gone (double submit): nothing to audit
    await recordAuditEvent({
      workspaceId,
      action: 'member.left',
      target: { type: 'member', id: memberId },
      metadata: { role: memberRole, apiKeysRevoked },
      context: audit,
    })
  },

  /**
   * LUM-906: an OWNER removes another member. OWNER only (403); not
   * yourself (400 — use leave); never the workspace's last OWNER (400); a
   * member of another workspace, or one already removed, is 404. The row is
   * deactivated (API keys revoked first, team memberships dropped,
   * authorship and sessions kept); `member.removed` records the removed
   * member's role and how many keys were revoked.
   */
  async removeMember(
    memberId: string,
    caller: { memberId: string; role: string; workspaceId: string },
    audit: AuditContext
  ) {
    if (caller.role !== 'OWNER') {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }
    if (memberId === caller.memberId) {
      throw Object.assign(
        new Error('You cannot remove yourself — leave the workspace instead'),
        { status: 400 }
      )
    }

    const target = await memberRepository.findById(memberId)
    if (!target || target.workspaceId !== caller.workspaceId) {
      throw Object.assign(new Error('Member not found'), { status: 404 })
    }
    if (target.role === 'OWNER') {
      const ownerCount = await memberRepository.countOwners(caller.workspaceId)
      if (ownerCount <= 1) {
        throw Object.assign(new Error('Cannot remove the last admin'), {
          status: 400,
        })
      }
    }

    // Personal integration credentials first (idempotent), then the row.
    await removeMemberIntegrations(caller.workspaceId, memberId, audit)
    const { deactivated, apiKeysRevoked } = await memberRepository.deactivate(
      memberId,
      'REMOVED'
    )
    if (!deactivated) {
      throw Object.assign(new Error('Member not found'), { status: 404 })
    }
    await recordAuditEvent({
      workspaceId: caller.workspaceId,
      action: 'member.removed',
      target: { type: 'member', id: memberId },
      metadata: { role: target.role, apiKeysRevoked },
      context: audit,
    })
    return { apiKeysRevoked }
  },
}
