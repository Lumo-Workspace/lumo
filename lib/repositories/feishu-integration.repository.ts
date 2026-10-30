import { Prisma } from '@prisma/client'
import { scopedPrisma, unscoped } from '@/lib/db/workspace-scope'

/**
 * LUM-1341 — persistence for the Feishu / Lark connection: the workspace
 * install (TEAM) and each member's account link (PERSONAL). Token columns are
 * stored as given — callers encrypt before writing (lib/crypto.ts). Every
 * query pins its workspace (scopedPrisma, LUM-979).
 */

/** Everything about the install except its token (LUM-1341 review). */
const INSTALL_STATUS_SELECT = {
  domain: true,
  appId: true,
  tenantKey: true,
  tenantName: true,
  createdAt: true,
} as const

const INSTALL_TOKEN_SELECT = {
  id: true,
  domain: true,
  appId: true,
  tenantKey: true,
  tenantAccessToken: true,
  tenantTokenExpiresAt: true,
} as const

export interface UpsertFeishuInstallData {
  workspaceId: string
  installedBy: string
  domain: string
  appId: string
  tenantKey: string
  tenantName: string
  /** Already encrypted. */
  tenantAccessToken: string
  tenantTokenExpiresAt: Date
}

export interface UpsertFeishuAccountData {
  workspaceId: string
  memberId: string
  domain: string
  tenantKey: string
  openId: string
  name: string | null
  /** Already encrypted. */
  accessToken: string
  /** Already encrypted. */
  refreshToken: string
  expiresAt: Date
  refreshExpiresAt: Date | null
  scopes: string[]
}

export interface FeishuAccountTokenUpdate {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  refreshExpiresAt: Date | null
}

const ACCOUNT_SELECT = {
  id: true,
  domain: true,
  tenantKey: true,
  name: true,
  accessToken: true,
  refreshToken: true,
  expiresAt: true,
  refreshExpiresAt: true,
  needsReauth: true,
} as const

export const feishuIntegrationRepository = {
  // ── Workspace install (TEAM) ─────────────────────────────────────────────

  findInstallStatus(workspaceId: string) {
    return scopedPrisma.feishuIntegration.findUnique({
      where: { workspaceId },
      select: INSTALL_STATUS_SELECT,
    })
  },

  findInstallWithToken(workspaceId: string) {
    return scopedPrisma.feishuIntegration.findUnique({
      where: { workspaceId },
      select: INSTALL_TOKEN_SELECT,
    })
  },

  /**
   * Bind (or re-bind) the workspace and, in the same transaction, delete the
   * workspace's member account links of any OTHER tenant (a reinstall into a
   * new tenant orphans them; a same-tenant reinstall keeps them).
   *
   * `tenantKey` is unique: when another workspace already holds this tenant
   * the upsert fails with P2002, the transaction rolls back (nothing is
   * deleted) and this returns 'tenant_taken' — also when two installs race.
   * A P2002 for any other reason is rethrown.
   */
  async upsertInstall(
    data: UpsertFeishuInstallData
  ): Promise<
    { status: 'ok'; removedAccounts: number } | { status: 'tenant_taken' }
  > {
    const { workspaceId, ...rest } = data
    try {
      const removed = await scopedPrisma.$transaction(async tx => {
        await tx.feishuIntegration.upsert({
          where: { workspaceId },
          create: { workspaceId, ...rest },
          update: rest,
        })
        return tx.feishuAccountIntegration.deleteMany({
          where: { workspaceId, NOT: { tenantKey: data.tenantKey } },
        })
      })
      return { status: 'ok', removedAccounts: removed.count }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const holder = await unscoped(
        'LUM-1341: which workspace holds this Feishu tenant (unique tenantKey)'
      ).feishuIntegration.findUnique({
        where: { tenantKey: data.tenantKey },
        select: { workspaceId: true },
      })
      if (holder && holder.workspaceId !== workspaceId) {
        return { status: 'tenant_taken' }
      }
      throw error
    }
  },

  /** False when the install was removed meanwhile (nothing written). */
  async updateTenantToken(
    workspaceId: string,
    id: string,
    next: { tenantAccessToken: string; tenantTokenExpiresAt: Date }
  ): Promise<boolean> {
    const { count } = await scopedPrisma.feishuIntegration.updateMany({
      where: { id, workspaceId },
      data: next,
    })
    return count > 0
  },

  /**
   * Remove the install and, in the same transaction, every member account
   * link in the workspace (their tokens belong to that install). Idempotent.
   */
  async deleteInstall(
    workspaceId: string
  ): Promise<{ install: boolean; accounts: number }> {
    return scopedPrisma.$transaction(async tx => {
      const accounts = await tx.feishuAccountIntegration.deleteMany({
        where: { workspaceId },
      })
      const install = await tx.feishuIntegration.deleteMany({
        where: { workspaceId },
      })
      return { install: install.count > 0, accounts: accounts.count }
    })
  },

  // ── Member account link (PERSONAL) ───────────────────────────────────────

  findAccount(workspaceId: string, memberId: string) {
    return scopedPrisma.feishuAccountIntegration.findUnique({
      where: { workspaceId_memberId: { workspaceId, memberId } },
      select: ACCOUNT_SELECT,
    })
  },

  async upsertAccount(data: UpsertFeishuAccountData): Promise<void> {
    const { workspaceId, memberId, ...rest } = data
    await scopedPrisma.feishuAccountIntegration.upsert({
      where: { workspaceId_memberId: { workspaceId, memberId } },
      create: { workspaceId, memberId, ...rest, needsReauth: false },
      update: { ...rest, needsReauth: false },
    })
  },

  /**
   * Compare-and-swap: store a rotated pair only if the row still holds the
   * refresh token that was rotated (`expectedRefreshToken`, the stored
   * ciphertext). False when another refresh got there first. A successful
   * rotation also clears a needsReauth a lost race may have set.
   */
  async updateAccountTokens(
    workspaceId: string,
    id: string,
    expectedRefreshToken: string,
    next: FeishuAccountTokenUpdate
  ): Promise<boolean> {
    const { count } = await scopedPrisma.feishuAccountIntegration.updateMany({
      where: { id, workspaceId, refreshToken: expectedRefreshToken },
      data: { ...next, needsReauth: false },
    })
    return count > 0
  },

  /**
   * Flag the link for reconnect only while it still holds the refresh token
   * that failed — never over a pair another refresh has since stored.
   */
  async markAccountNeedsReauth(
    workspaceId: string,
    id: string,
    expectedRefreshToken: string
  ): Promise<boolean> {
    const { count } = await scopedPrisma.feishuAccountIntegration.updateMany({
      where: { id, workspaceId, refreshToken: expectedRefreshToken },
      data: { needsReauth: true },
    })
    return count > 0
  },

  /** Idempotent: true when a row (and so its tokens) was removed. */
  async deleteAccount(workspaceId: string, memberId: string): Promise<boolean> {
    const { count } = await scopedPrisma.feishuAccountIntegration.deleteMany({
      where: { workspaceId, memberId },
    })
    return count > 0
  },
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}
