import { inviteRepository } from '@/lib/repositories/invite.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'
import { INVITE_EMAIL_MISMATCH, maskEmail } from '@/lib/utils/invite'

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

  /**
   * Get invite details by token (public, no auth required). Anyone holding
   * the link can call this, so the invited address is only ever returned
   * masked (`a***@acme.com`) — enough for the invitee to recognise which
   * account to sign in with, not enough to harvest it.
   */
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
      maskedEmail: maskEmail(invite.email),
      status:
        isExpired && invite.status === 'PENDING'
          ? ('EXPIRED' as const)
          : invite.status,
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

  /**
   * Accept an invite: create member, add to default team, mark accepted.
   *
   * The invite is bound to the address it was sent to: one of the caller's
   * IdP-verified emails (`verifiedEmails`, from `getVerifiedEmails`) must
   * equal `invite.email`, case-insensitively — holding the link alone is not
   * enough. A mismatch is a 403 with code INVITE_EMAIL_MISMATCH and the
   * masked invited address, so the page can say which account to use. A
   * caller who is already a member still lands on the workspace.
   */
  async acceptInvite(
    token: string,
    clerkId: string,
    verifiedEmails: readonly string[],
    audit?: AuditContext
  ) {
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

    // Idempotent: already an active member → return workspace slug. A
    // deactivated row (LUM-906) is reactivated below, after the email check.
    const existing = await memberRepository.findMembershipStatus(
      invite.workspaceId,
      clerkId
    )
    if (existing && existing.deactivatedAt === null) {
      return { workspaceSlug: invite.workspace.slug, alreadyMember: true }
    }
    const deactivatedMemberId = existing?.id ?? null

    const invited = invite.email.toLowerCase()
    if (!verifiedEmails.some(e => e.toLowerCase() === invited)) {
      throw Object.assign(
        new Error('This invitation was sent to a different email address'),
        {
          status: 403,
          code: INVITE_EMAIL_MISMATCH,
          maskedEmail: maskEmail(invite.email),
        }
      )
    }

    const member = await inviteRepository.acceptInTransaction(
      invite,
      clerkId,
      deactivatedMemberId
    )
    await recordAuditEvent({
      workspaceId: invite.workspaceId,
      action: 'invite.accepted',
      target: { type: 'invite', id: invite.id },
      metadata: {
        memberId: member.id,
        via: 'link',
        reactivated: deactivatedMemberId !== null,
      },
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
      const existing = await memberRepository.findMembershipStatus(
        invite.workspaceId,
        clerkId
      )
      if (existing && existing.deactivatedAt === null) {
        await inviteRepository.updateStatus(invite.id, 'ACCEPTED', {
          acceptedAt: new Date(),
        })
      } else {
        // LUM-906: a deactivated row is reactivated, not duplicated.
        const deactivatedMemberId = existing?.id ?? null
        const member = await inviteRepository.acceptInTransaction(
          invite,
          clerkId,
          deactivatedMemberId
        )
        await recordAuditEvent({
          workspaceId: invite.workspaceId,
          action: 'invite.accepted',
          target: { type: 'invite', id: invite.id },
          metadata: {
            memberId: member.id,
            via: 'verified_email',
            reactivated: deactivatedMemberId !== null,
          },
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
      throw Object.assign(new Error('Invite not found'), {
        status: 404,
        code: 'INVITE_NOT_FOUND',
      })
    }
    if (invite.status !== 'PENDING') {
      throw Object.assign(new Error('Only PENDING invites can be resent'), {
        status: 400,
        code: 'INVITE_NOT_PENDING',
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
