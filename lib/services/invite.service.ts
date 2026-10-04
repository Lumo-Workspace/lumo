import { inviteRepository } from '@/lib/repositories/invite.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'

// ── Invite Service ─────────────────────────────────────────────────────────

export const inviteService = {
  /**
   * Send invites to a list of emails.
   * For each email: deletes any existing pending invite, creates a new one,
   * and returns the created invite for the caller to send emails.
   */
  async createInvites(
    workspaceId: string,
    emails: string[],
    inviterName: string,
    invitedById: string,
    expiresAt: Date,
    audit?: AuditContext
  ) {
    const results: Array<{
      email: string
      invite: Awaited<ReturnType<typeof inviteRepository.create>>
    }> = []

    for (const rawEmail of emails) {
      const email = rawEmail.toLowerCase()

      // Upsert: delete any existing pending invite for this email+workspace
      await inviteRepository.deletePendingByEmail(workspaceId, email)

      const invite = await inviteRepository.create({
        workspaceId,
        email,
        inviterName,
        invitedById,
        expiresAt,
      })

      results.push({ email, invite })
      await recordAuditEvent({
        workspaceId,
        action: 'invite.created',
        target: { type: 'invite', id: invite.id },
        metadata: { email, expiresAt },
        context: audit,
      })
    }

    return results
  },

  /** List all pending invites for a workspace. */
  async listPendingInvites(workspaceId: string) {
    return inviteRepository.findPendingByWorkspace(workspaceId)
  },

  /** Get invite details by token (public, no auth required). */
  async getInviteByToken(token: string) {
    const invite = await inviteRepository.findByToken(token)
    if (!invite) {
      throw Object.assign(new Error('Invite not found'), { status: 404 })
    }

    const isExpired = invite.expiresAt < new Date()

    return {
      workspaceName: invite.workspace.name,
      workspaceSlug: invite.workspace.slug,
      inviterName: invite.inviterName,
      email: invite.email,
      status:
        isExpired && invite.status === 'PENDING' ? 'EXPIRED' : invite.status,
    }
  },

  /** Revoke a pending invite. Caller must own the workspace. */
  async revokeInvite(
    token: string,
    callerWorkspaceId: string,
    audit?: AuditContext
  ) {
    const invite = await inviteRepository.findByTokenForAuth(token)
    if (!invite || invite.workspaceId !== callerWorkspaceId) {
      throw Object.assign(new Error('Invite not found'), { status: 404 })
    }
    if (invite.status !== 'PENDING') {
      throw Object.assign(new Error('Only PENDING invites can be revoked'), {
        status: 400,
      })
    }

    await inviteRepository.updateStatus(invite.id, 'REVOKED')
    await recordAuditEvent({
      workspaceId: callerWorkspaceId,
      action: 'invite.revoked',
      target: { type: 'invite', id: invite.id },
      context: audit,
    })
  },

  /** Accept an invite: create member, add to default team, mark accepted. */
  async acceptInvite(token: string, clerkId: string, audit?: AuditContext) {
    const invite = await inviteRepository.findByTokenWithWorkspace(token)
    if (!invite) {
      throw Object.assign(new Error('Invite not found'), { status: 404 })
    }
    if (invite.status !== 'PENDING') {
      throw Object.assign(
        new Error('This invitation has already been used or revoked'),
        { status: 409 }
      )
    }
    if (invite.expiresAt < new Date()) {
      throw Object.assign(new Error('This invitation has expired'), {
        status: 410,
      })
    }

    // Idempotent: already a member → return workspace slug
    const existingMember = await memberRepository.findByWorkspaceAndClerkId(
      invite.workspaceId,
      clerkId
    )
    if (existingMember) {
      return { workspaceSlug: invite.workspace.slug, alreadyMember: true }
    }

    const member = await inviteRepository.acceptInTransaction(invite, clerkId)
    await recordAuditEvent({
      workspaceId: invite.workspaceId,
      action: 'invite.accepted',
      target: { type: 'invite', id: invite.id },
      metadata: { memberId: member.id, via: 'link' },
      context: {
        ...(audit ?? { source: 'WEB' }),
        actor: { type: 'MEMBER', clerkId, memberId: member.id },
      },
    })

    return { workspaceSlug: invite.workspace.slug, alreadyMember: false }
  },

  /**
   * Join every workspace that has a live invite for one of the user's
   * verified emails — the path for an invitee who signs in directly instead
   * of clicking the invite link. Returns the newest invite's workspace slug
   * to land on, or null when there is nothing to join. Callers must pass
   * only emails the identity provider has verified.
   */
  async joinPendingInvitesForEmails(
    clerkId: string,
    verifiedEmails: string[],
    audit?: AuditContext
  ): Promise<string | null> {
    const emails = [...new Set(verifiedEmails.map(e => e.toLowerCase()))]
    if (emails.length === 0) return null

    const invites = await inviteRepository.findPendingByEmails(
      emails,
      new Date()
    )

    let landingSlug: string | null = null
    for (const invite of invites) {
      const existingMember = await memberRepository.findByWorkspaceAndClerkId(
        invite.workspaceId,
        clerkId
      )
      if (existingMember) {
        await inviteRepository.updateStatus(invite.id, 'ACCEPTED', {
          acceptedAt: new Date(),
        })
      } else {
        const member = await inviteRepository.acceptInTransaction(
          invite,
          clerkId
        )
        await recordAuditEvent({
          workspaceId: invite.workspaceId,
          action: 'invite.accepted',
          target: { type: 'invite', id: invite.id },
          metadata: { memberId: member.id, via: 'verified_email' },
          context: {
            ...(audit ?? { source: 'WEB' }),
            actor: { type: 'MEMBER', clerkId, memberId: member.id },
          },
        })
      }
      landingSlug ??= invite.workspace.slug
    }

    return landingSlug
  },

  /** Resend an invite: reset expiry and return invite data for email sending. */
  async resendInvite(
    token: string,
    callerWorkspaceId: string,
    audit?: AuditContext
  ) {
    const invite = await inviteRepository.findByTokenForResend(token)
    if (!invite || invite.workspaceId !== callerWorkspaceId) {
      throw Object.assign(new Error('Invite not found'), { status: 404 })
    }
    if (invite.status !== 'PENDING') {
      throw Object.assign(new Error('Only PENDING invites can be resent'), {
        status: 400,
      })
    }

    await recordAuditEvent({
      workspaceId: callerWorkspaceId,
      action: 'invite.resent',
      target: { type: 'invite', id: invite.id },
      context: audit,
    })
    return invite
  },
}
