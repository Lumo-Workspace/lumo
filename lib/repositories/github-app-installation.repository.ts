import { prisma } from '@/lib/db/prisma'

export interface UpsertGitHubAppInstallationData {
  workspaceId: string
  installationId: number
  accountLogin?: string | null
  accountType?: string | null
  repositories?: string[]
  installedBy?: string | null
  /** LUM-882 — only written when given; webhook upserts leave it alone. */
  verifierLogin?: string
}

export const githubAppInstallationRepository = {
  async findByWorkspace(workspaceId: string) {
    return prisma.gitHubAppInstallation.findUnique({
      where: { workspaceId },
      select: { id: true, workspaceId: true, installationId: true },
    })
  },

  /** The fields the settings card renders — account + repository scope. */
  async findStatusByWorkspace(workspaceId: string) {
    return prisma.gitHubAppInstallation.findUnique({
      where: { workspaceId },
      select: {
        installationId: true,
        accountLogin: true,
        accountType: true,
        repositories: true,
        createdAt: true,
        verifierLogin: true,
        accessRemovedCount: true,
        accessRemovedAt: true,
      },
    })
  },

  /**
   * LUM-872 — every workspace bound to an installation. `installationId` is
   * deliberately not unique: GitHub allows one installation per account, so a
   * second Lumo workspace on the same org re-uses it. Anything that must reach
   * all of them (uninstall scrub, repository scope) reads this, not the
   * single-row lookup above.
   */
  async findAllByInstallationId(installationId: number) {
    return prisma.gitHubAppInstallation.findMany({
      where: { installationId },
      select: {
        id: true,
        workspaceId: true,
        installationId: true,
        repositories: true,
        verifierLogin: true,
      },
      orderBy: { createdAt: 'asc' },
    })
  },

  async upsert(data: UpsertGitHubAppInstallationData) {
    return prisma.gitHubAppInstallation.upsert({
      where: { workspaceId: data.workspaceId },
      create: {
        workspaceId: data.workspaceId,
        installationId: data.installationId,
        accountLogin: data.accountLogin ?? null,
        accountType: data.accountType ?? null,
        repositories: data.repositories ?? [],
        installedBy: data.installedBy ?? null,
        verifierLogin: data.verifierLogin ?? null,
      },
      update: {
        installationId: data.installationId,
        accountLogin: data.accountLogin ?? null,
        accountType: data.accountType ?? null,
        repositories: data.repositories ?? [],
        ...(data.verifierLogin !== undefined && {
          verifierLogin: data.verifierLogin,
          accessRemovedCount: 0,
          accessRemovedAt: null,
          accessCheckCursor: null,
        }),
      },
    })
  },

  /**
   * LUM-882 — an owner re-verified: the confirmed list is what this verifier
   * reads now, so the recheck follows them and any earlier removal notice or
   * half-finished recheck is stale.
   */
  async recordVerification(
    workspaceId: string,
    repositories: string[],
    verifierLogin: string
  ) {
    return prisma.gitHubAppInstallation.update({
      where: { workspaceId },
      data: {
        repositories,
        verifierLogin,
        accessRemovedCount: 0,
        accessRemovedAt: null,
        accessCheckCursor: null,
      },
      select: { id: true },
    })
  },

  /** LUM-882 — installations the access recheck can run on. */
  async findAllWithVerifier() {
    return prisma.gitHubAppInstallation.findMany({
      where: { verifierLogin: { not: null } },
      select: {
        workspaceId: true,
        installationId: true,
        repositories: true,
        verifierLogin: true,
        accessCheckCursor: true,
      },
      orderBy: { createdAt: 'asc' },
    })
  },

  /**
   * LUM-882 — the fields the access recheck narrows, plus `updatedAt` as the
   * version for `updateRecheckIfUnchanged`.
   */
  async findRecheckState(workspaceId: string) {
    return prisma.gitHubAppInstallation.findUnique({
      where: { workspaceId },
      select: {
        repositories: true,
        verifierLogin: true,
        accessRemovedCount: true,
        updatedAt: true,
      },
    })
  },

  /**
   * LUM-882 — write a recheck result only if the row is still the version it
   * was computed from (same verifier, same `updatedAt`). Returns whether it
   * was written; the caller decides what a lost race means.
   */
  async updateRecheckIfUnchanged(
    workspaceId: string,
    expected: { verifierLogin: string; updatedAt: Date },
    data: {
      repositories: string[]
      accessCheckCursor?: string | null
      accessRemovedCount?: number
      accessRemovedAt?: Date
    }
  ) {
    const { count } = await prisma.gitHubAppInstallation.updateMany({
      where: {
        workspaceId,
        verifierLogin: expected.verifierLogin,
        updatedAt: expected.updatedAt,
      },
      data,
    })
    return count === 1
  },

  async updateRepositories(workspaceId: string, repositories: string[]) {
    return prisma.gitHubAppInstallation.update({
      where: { workspaceId },
      data: { repositories },
    })
  },

  async delete(workspaceId: string) {
    return prisma.gitHubAppInstallation.delete({ where: { workspaceId } })
  },

  /** Idempotent delete used by the `installation` webhook (deleted/suspend). */
  async deleteByInstallationId(installationId: number) {
    return prisma.gitHubAppInstallation.deleteMany({
      where: { installationId },
    })
  },
}
