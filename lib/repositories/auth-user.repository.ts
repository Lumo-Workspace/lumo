import { prisma } from '@/lib/db/prisma'

/**
 * LUM-1027 — reads and profile writes on the Better Auth user table
 * (`auth_users`), for the self-hosted user directory
 * (lib/auth/better-auth/users.ts). Better Auth itself writes these rows
 * through its Prisma adapter; this repository only serves Lumo's lookups.
 */

/** The columns the user directory needs — never the password/account rows. */
const AUTH_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  firstName: true,
  lastName: true,
} as const

export interface AuthUserRecord {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  firstName: string | null
  lastName: string | null
}

/** LUM-1344 — what the platform admin guard needs to authorize a user. */
export interface AuthUserPlatformAccess {
  id: string
  email: string
  role: string | null
  banned: boolean
}

export interface AuthUserListFilter {
  ids?: string[] | undefined
  emails?: string[] | undefined
  limit: number
}

export interface AuthUserProfileUpdate {
  name?: string
  firstName?: string | null
  lastName?: string | null
  image?: string | null
}

export const authUserRepository = {
  async findById(id: string): Promise<AuthUserRecord | null> {
    return prisma.authUser.findUnique({
      where: { id },
      select: AUTH_USER_SELECT,
    })
  },

  /** LUM-1344 — id, email, role and ban flag only (platform admin guard). */
  async findPlatformAccessById(
    id: string
  ): Promise<AuthUserPlatformAccess | null> {
    const row = await prisma.authUser.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, banned: true },
    })
    if (!row) return null
    return { ...row, banned: row.banned === true }
  },

  /**
   * Users matching ANY of the given ids or emails (emails compared
   * case-insensitively), at most `limit`. No filter at all → first `limit`.
   */
  async findMany(filter: AuthUserListFilter): Promise<AuthUserRecord[]> {
    const or = [
      ...(filter.ids?.length ? [{ id: { in: filter.ids } }] : []),
      ...(filter.emails?.length
        ? filter.emails.map(email => ({
            email: { equals: email, mode: 'insensitive' as const },
          }))
        : []),
    ]
    const hadFilter = filter.ids !== undefined || filter.emails !== undefined
    if (hadFilter && or.length === 0) return []
    return prisma.authUser.findMany({
      where: or.length ? { OR: or } : {},
      select: AUTH_USER_SELECT,
      orderBy: { createdAt: 'asc' },
      take: filter.limit,
    })
  },

  async update(
    id: string,
    data: AuthUserProfileUpdate
  ): Promise<AuthUserRecord> {
    return prisma.authUser.update({
      where: { id },
      data,
      select: AUTH_USER_SELECT,
    })
  },
}
