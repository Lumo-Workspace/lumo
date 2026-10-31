import type { Prisma, WorkspaceRole } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

/**
 * LUM-1344: cross-tenant reads for the platform admin API. Deliberately
 * separate from the workspace-scoped repositories. No business logic here;
 * WorkspaceMember.clerkId is joined to AuthUser.id by the service (no
 * Prisma relation exists between them).
 */

export interface PageArgs {
  q?: string | undefined
  cursor?: string | undefined
  take: number
}

const WORKSPACE_SELECT = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
} satisfies Prisma.WorkspaceSelect

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
  banned: true,
  role: true,
} satisfies Prisma.AuthUserSelect

export type AdminWorkspaceRow = Prisma.WorkspaceGetPayload<{
  select: typeof WORKSPACE_SELECT
}>
export type AdminUserRow = Prisma.AuthUserGetPayload<{
  select: typeof USER_SELECT
}>

export interface AdminMemberRow {
  workspaceId: string
  clerkId: string
  role: WorkspaceRole
  joinedAt: Date
}

export interface AdminUserMembershipRow {
  role: WorkspaceRole
  workspace: { id: string; name: string; slug: string }
}

export interface AdminSpendRow {
  workspaceId: string
  month: string
  usdMicros: bigint
}

const PAGE_ORDER = [{ createdAt: 'desc' }, { id: 'desc' }] as const

export const platformAdminRepository = {
  async listWorkspaces(args: PageArgs): Promise<AdminWorkspaceRow[]> {
    const where: Prisma.WorkspaceWhereInput = args.q
      ? {
          OR: [
            { name: { contains: args.q, mode: 'insensitive' } },
            { slug: { contains: args.q, mode: 'insensitive' } },
          ],
        }
      : {}
    return prisma.workspace.findMany({
      where,
      select: WORKSPACE_SELECT,
      orderBy: [...PAGE_ORDER],
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    })
  },

  async findWorkspace(id: string): Promise<AdminWorkspaceRow | null> {
    return prisma.workspace.findUnique({
      where: { id },
      select: WORKSPACE_SELECT,
    })
  },

  async findWorkspacesByIds(
    ids: string[]
  ): Promise<{ id: string; name: string }[]> {
    if (ids.length === 0) return []
    return prisma.workspace.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    })
  },

  /** Active (not deactivated) members of the given workspaces. */
  async listActiveMembers(workspaceIds: string[]): Promise<AdminMemberRow[]> {
    if (workspaceIds.length === 0) return []
    return prisma.workspaceMember.findMany({
      where: { workspaceId: { in: workspaceIds }, deactivatedAt: null },
      select: {
        workspaceId: true,
        clerkId: true,
        role: true,
        joinedAt: true,
      },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    })
  },

  async listUsers(args: PageArgs): Promise<AdminUserRow[]> {
    const where: Prisma.AuthUserWhereInput = args.q
      ? { email: { contains: args.q, mode: 'insensitive' } }
      : {}
    return prisma.authUser.findMany({
      where,
      select: USER_SELECT,
      orderBy: [...PAGE_ORDER],
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    })
  },

  async findUser(id: string): Promise<AdminUserRow | null> {
    return prisma.authUser.findUnique({ where: { id }, select: USER_SELECT })
  },

  async findUserEmails(
    ids: string[]
  ): Promise<{ id: string; email: string }[]> {
    if (ids.length === 0) return []
    return prisma.authUser.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true },
    })
  },

  /** Active memberships of one user, with the workspace identity. */
  async listUserMemberships(userId: string): Promise<AdminUserMembershipRow[]> {
    return prisma.workspaceMember.findMany({
      where: { clerkId: userId, deactivatedAt: null },
      select: {
        role: true,
        workspace: { select: { id: true, name: true, slug: true } },
      },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    })
  },

  /** Spend rows (one per feature) for a month, optionally one workspace. */
  async listSpendForMonth(month: string): Promise<AdminSpendRow[]> {
    return prisma.workspaceLlmSpend.findMany({
      where: { month },
      select: { workspaceId: true, month: true, usdMicros: true },
    })
  },

  async listSpendForWorkspace(workspaceId: string): Promise<AdminSpendRow[]> {
    return prisma.workspaceLlmSpend.findMany({
      where: { workspaceId },
      select: { workspaceId: true, month: true, usdMicros: true },
    })
  },

  async countWorkspaces(): Promise<number> {
    return prisma.workspace.count()
  },

  async countUsers(): Promise<number> {
    return prisma.authUser.count()
  },

  async countPendingWaitlist(): Promise<number> {
    return prisma.waitlistEntry.count({ where: { status: 'PENDING' } })
  },
}
