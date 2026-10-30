import { prisma } from '@/lib/db/prisma'

/**
 * LUM-1071 — operator writes on the Better Auth user tables: the ban fields
 * the admin plugin declares (lib/auth/better-auth/admin-plugin.ts), revoking
 * a user's sessions and MCP OAuth tokens, and deleting the user. Only
 * lib/services/auth-user-admin.service.ts calls this; it never reads the
 * person's name, email or credentials back.
 */

/** A user's ban state — no personal data. */
export interface AuthUserBanState {
  id: string
  role: string | null
  banned: boolean
  banExpires: Date | null
}

export interface AuthUserCredentialCounts {
  sessions: number
  oauthTokens: number
}

export interface AuthUserRevocation {
  sessionsRevoked: number
  oauthTokensRevoked: number
}

export const authUserAdminRepository = {
  async findBanState(id: string): Promise<AuthUserBanState | null> {
    const row = await prisma.authUser.findUnique({
      where: { id },
      select: { id: true, role: true, banned: true, banExpires: true },
    })
    if (!row) return null
    return { ...row, banned: row.banned === true }
  },

  /** The id of the user with this email (case-insensitive), or null. */
  async findIdByEmail(email: string): Promise<string | null> {
    const row = await prisma.authUser.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    })
    return row?.id ?? null
  },

  /** Live sessions and MCP OAuth tokens (access + refresh) of a user. */
  async countCredentials(userId: string): Promise<AuthUserCredentialCounts> {
    const [sessions, access, refresh] = await Promise.all([
      prisma.authSession.count({ where: { userId } }),
      prisma.authOauthAccessToken.count({ where: { userId } }),
      prisma.authOauthRefreshToken.count({ where: { userId } }),
    ])
    return { sessions, oauthTokens: access + refresh }
  },

  /**
   * Ban a user and revoke what they are signed in with, in one transaction:
   * set the ban fields, delete every session, delete every MCP OAuth access
   * and refresh token. Repeating it rewrites the same fields and revokes 0.
   */
  async banAndRevoke(
    userId: string,
    ban: { reason: string | null; expiresAt: Date | null }
  ): Promise<AuthUserRevocation> {
    return prisma.$transaction(async tx => {
      await tx.authUser.update({
        where: { id: userId },
        data: {
          banned: true,
          banReason: ban.reason,
          banExpires: ban.expiresAt,
        },
      })
      const sessions = await tx.authSession.deleteMany({ where: { userId } })
      const access = await tx.authOauthAccessToken.deleteMany({
        where: { userId },
      })
      const refresh = await tx.authOauthRefreshToken.deleteMany({
        where: { userId },
      })
      return {
        sessionsRevoked: sessions.count,
        oauthTokensRevoked: access.count + refresh.count,
      }
    })
  },

  /** Lift a ban. Returns whether the user was banned. */
  async clearBan(userId: string): Promise<boolean> {
    const { count } = await prisma.authUser.updateMany({
      where: { id: userId, banned: true },
      data: { banned: false, banReason: null, banExpires: null },
    })
    return count > 0
  },

  /** LUM-1344 — set `auth_users.role` (the platform admin flag). */
  async setRole(userId: string, role: string): Promise<void> {
    await prisma.authUser.update({ where: { id: userId }, data: { role } })
  },

  /**
   * Delete a user. Sessions, linked accounts (password, GitHub, Google), MCP
   * OAuth tokens, consents and clients go with it (ON DELETE CASCADE); the
   * counts are taken in the same transaction for the report.
   */
  async deleteUser(
    userId: string
  ): Promise<AuthUserRevocation & { deleted: boolean }> {
    return prisma.$transaction(async tx => {
      // Sequential: one interactive transaction is one connection.
      const sessions = await tx.authSession.count({ where: { userId } })
      const access = await tx.authOauthAccessToken.count({ where: { userId } })
      const refresh = await tx.authOauthRefreshToken.count({
        where: { userId },
      })
      const { count } = await tx.authUser.deleteMany({ where: { id: userId } })
      return {
        deleted: count > 0,
        sessionsRevoked: count > 0 ? sessions : 0,
        oauthTokensRevoked: count > 0 ? access + refresh : 0,
      }
    })
  },
}
