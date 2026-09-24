import { prisma } from '@/lib/db/prisma'
import type { InviteStatus } from '@prisma/client'

// ── Types ───────────────────────────────────────────────────────────────────

export interface CreateInviteData {
  workspaceId: string
  email: string
  inviterName: string
  invitedById: string
  expiresAt: Date
}

// ── Invite Repository ──────────────────────────────────────────────────────

export const inviteRepository = {
  /** Delete all pending invites for a given email + workspace. */
  async deletePendingByEmail(workspaceId: string, email: string) {
    return prisma.workspaceInvite.deleteMany({
      where: { workspaceId, email, status: 'PENDING' },
    })
  },

  /** Create a new workspace invite. */
  async create(data: CreateInviteData) {
    return prisma.workspaceInvite.create({ data })
  },

  /** List pending invites for a workspace, newest first. */
  async findPendingByWorkspace(workspaceId: string) {
    return prisma.workspaceInvite.findMany({
      where: { workspaceId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        token: true,
        email: true,
        inviterName: true,
        expiresAt: true,
        createdAt: true,
      },
    })
  },

  /**
   * Unexpired PENDING invites addressed to any of the given (lowercase)
   * emails, across all workspaces, newest first — with the default team
   * `acceptInTransaction` needs.
   */
  async findPendingByEmails(emails: string[], now: Date) {
    return prisma.workspaceInvite.findMany({
      where: {
        email: { in: emails },
        status: 'PENDING',
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        workspaceId: true,
        workspace: {
          select: {
            slug: true,
            teams: {
              where: { isDefault: true },
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    })
  },

  /** Find an invite by token (public info for invite page). */
  async findByToken(token: string) {
    return prisma.workspaceInvite.findUnique({
      where: { token },
      select: {
        status: true,
        expiresAt: true,
        email: true,
        inviterName: true,
        workspace: { select: { name: true, slug: true } },
      },
    })
  },

  /** Find an invite by token with minimal fields for authorization checks. */
  async findByTokenForAuth(token: string) {
    return prisma.workspaceInvite.findUnique({
      where: { token },
      select: { id: true, workspaceId: true, status: true },
    })
  },

  /** Find an invite by token with full workspace + default team data for acceptance. */
  async findByTokenWithWorkspace(token: string) {
    return prisma.workspaceInvite.findUnique({
      where: { token },
      include: {
        workspace: {
          include: {
            teams: { where: { isDefault: true }, take: 1 },
          },
        },
      },
    })
  },

  /** Find an invite by token with workspace info for resend. */
  async findByTokenForResend(token: string) {
    return prisma.workspaceInvite.findUnique({
      where: { token },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        email: true,
        inviterName: true,
        workspace: { select: { name: true, slug: true } },
      },
    })
  },

  /** Update invite status (e.g. REVOKED, ACCEPTED). */
  async updateStatus(
    id: string,
    status: InviteStatus,
    extra?: { acceptedAt?: Date }
  ) {
    return prisma.workspaceInvite.update({
      where: { id },
      data: { status, ...extra },
    })
  },

  /** Reset invite expiry date. */
  async resetExpiry(id: string, expiresAt: Date) {
    return prisma.workspaceInvite.update({
      where: { id },
      data: { expiresAt },
    })
  },

  /** Accept invite in a transaction: create member + actor + team membership + mark accepted. */
  async acceptInTransaction(
    invite: {
      id: string
      workspaceId: string
      workspace: { slug: string; teams: Array<{ id: string }> }
    },
    clerkId: string
  ) {
    const defaultTeam = invite.workspace.teams[0]

    return prisma.$transaction(async tx => {
      const member = await tx.workspaceMember.create({
        data: {
          workspaceId: invite.workspaceId,
          clerkId,
          role: 'MEMBER',
        },
      })

      await tx.actor.create({
        data: {
          workspaceId: invite.workspaceId,
          type: 'HUMAN',
          memberId: member.id,
        },
      })

      if (defaultTeam) {
        await tx.teamMember.create({
          data: { teamId: defaultTeam.id, memberId: member.id },
        })
      }

      await tx.workspaceInvite.update({
        where: { id: invite.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      })

      return member
    })
  },
}
