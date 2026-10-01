import { prisma } from '@/lib/db/prisma'

export interface UpsertGitHubAppInstallationData {
  workspaceId: string
  installationId: number
  accountLogin?: string | null
  accountType?: string | null
  repositories?: string[]
  installedBy?: string | null
  /**
   * LUM-882 — only written when given; webhook upserts leave it alone.
   * LUM-888 — together with the account's immutable id; writing a verifier
   * starts a new verification version.
   */
  verifier?: { login: string; githubId: number }
}

export const githubAppInstallationRepository = {
  async findByWorkspace(workspaceId: string) {
    return prisma.gitHubAppInstallation.findUnique({
      where: { workspaceId },
      // `repositories` is the confirmed list every token mint checks (LUM-883).
      select: {
        id: true,
        workspaceId: true,
        installationId: true,
        repositories: true,
      },
    })
  },

  /** LUM-902 — the confirmed lists of these workspaces (absent: no App). */
  async findConfirmedLists(workspaceIds: string[]) {
    return prisma.gitHubAppInstallation.findMany({
      where: { workspaceId: { in: workspaceIds } },
      select: { workspaceId: true, repositories: true },
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
        accessRemovedReason: true,
        tokenFailingSince: true,
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
        verifierGithubId: true,
        verifiedAt: true,
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
        verifierLogin: data.verifier?.login ?? null,
        verifierGithubId: data.verifier?.githubId ?? null,
        verifiedAt: data.verifier ? new Date() : null,
      },
      update: {
        installationId: data.installationId,
        accountLogin: data.accountLogin ?? null,
        accountType: data.accountType ?? null,
        repositories: data.repositories ?? [],
        ...(data.verifier && {
          verifierLogin: data.verifier.login,
          verifierGithubId: data.verifier.githubId,
          verifiedAt: new Date(),
          accessRemovedCount: 0,
          accessRemovedAt: null,
          accessRemovedReason: null,
          accessCheckCursor: null,
        }),
      },
    })
  },

  /**
   * LUM-882 — an owner re-verified: the confirmed list is what this verifier
   * reads now, so the recheck follows them and any earlier removal notice or
   * half-finished recheck is stale. LUM-888 — a new `verifiedAt` is what
   * makes it stale: a recheck in flight is discarded even when the same login
   * re-verified.
   */
  async recordVerification(
    workspaceId: string,
    repositories: string[],
    verifier: { login: string; githubId: number }
  ) {
    return prisma.gitHubAppInstallation.update({
      where: { workspaceId },
      data: {
        repositories,
        verifierLogin: verifier.login,
        verifierGithubId: verifier.githubId,
        verifiedAt: new Date(),
        accessRemovedCount: 0,
        accessRemovedAt: null,
        accessRemovedReason: null,
        accessCheckCursor: null,
      },
      select: { id: true },
    })
  },

  /**
   * LUM-882 — installations the access recheck can run on. LUM-888 — the
   * longest-waiting first (never-checked before all), so a sweep the time
   * budget cuts short picks up where the last one left off.
   */
  async findAllWithVerifier() {
    return prisma.gitHubAppInstallation.findMany({
      where: { verifierLogin: { not: null }, verifiedAt: { not: null } },
      select: {
        workspaceId: true,
        installationId: true,
        repositories: true,
        verifierLogin: true,
        verifierGithubId: true,
        verifiedAt: true,
        accessCheckCursor: true,
      },
      orderBy: [
        { accessCheckedAt: { sort: 'asc', nulls: 'first' } },
        { createdAt: 'asc' },
      ],
    })
  },

  /**
   * LUM-882 — the fields the access recheck narrows, plus the versions
   * `updateRecheckIfUnchanged` checks: `verifiedAt` (which verification the
   * result belongs to) and `updatedAt` (any other write since the read).
   */
  async findRecheckState(workspaceId: string) {
    return prisma.gitHubAppInstallation.findUnique({
      where: { workspaceId },
      select: {
        repositories: true,
        verifierLogin: true,
        verifiedAt: true,
        accessRemovedCount: true,
        updatedAt: true,
      },
    })
  },

  /**
   * LUM-882 — write a recheck result only if the row is still the version it
   * was computed from (same verification, same `updatedAt`). Returns whether
   * it was written; the caller decides what a lost race means.
   */
  async updateRecheckIfUnchanged(
    workspaceId: string,
    expected: { verifiedAt: Date; updatedAt: Date },
    data: {
      repositories: string[]
      accessCheckCursor?: string | null
      accessCheckedAt?: Date
      accessRemovedCount?: number
      accessRemovedAt?: Date
      accessRemovedReason?: string
      verifierLogin?: string
      verifierGithubId?: number
    }
  ) {
    const { count } = await prisma.gitHubAppInstallation.updateMany({
      where: {
        workspaceId,
        verifiedAt: expected.verifiedAt,
        updatedAt: expected.updatedAt,
      },
      data,
    })
    return count === 1
  },

  /**
   * LUM-895 — the sweep reached this row but wrote no result (a scrub that
   * threw, a write that kept losing the race, GitHub not answering): stamp it
   * anyway, so a row that fails every day rotates behind the others instead
   * of going first forever. Only the rotation stamp; the list and resume
   * point are left for the next attempt.
   */
  async markRecheckAttempted(workspaceId: string) {
    await prisma.gitHubAppInstallation.updateMany({
      where: { workspaceId },
      data: { accessCheckedAt: new Date() },
    })
  },

  async updateRepositories(workspaceId: string, repositories: string[]) {
    return prisma.gitHubAppInstallation.update({
      where: { workspaceId },
      data: { repositories },
    })
  },

  /**
   * LUM-902 — idempotent per-workspace delete. With `installationId`, only
   * while the row is still bound to that installation: a workspace that
   * re-installed another one in the meantime keeps its new binding.
   */
  async deleteForWorkspace(workspaceId: string, installationId?: number) {
    return prisma.gitHubAppInstallation.deleteMany({
      where: {
        workspaceId,
        ...(installationId !== undefined && { installationId }),
      },
    })
  },

  /**
   * LUM-927 — every row, for narrowing to what its installation contains
   * now. Includes rows with no verifier (bound before LUM-882), which the
   * access recheck cannot ask about. `updatedAt` is the version
   * `updateRepositoriesIfUnchanged` checks.
   */
  async findAllForInstallationNarrowing() {
    return prisma.gitHubAppInstallation.findMany({
      select: {
        workspaceId: true,
        installationId: true,
        repositories: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })
  },

  /**
   * LUM-927 — narrow a row's confirmed list only if nothing else wrote it
   * since it was read (a webhook, a re-verification). Returns whether it was
   * written; a lost race is retried by the next run.
   */
  async updateRepositoriesIfUnchanged(
    workspaceId: string,
    expectedUpdatedAt: Date,
    repositories: string[]
  ) {
    const { count } = await prisma.gitHubAppInstallation.updateMany({
      where: { workspaceId, updatedAt: expectedUpdatedAt },
      data: { repositories },
    })
    return count === 1
  },

  /**
   * LUM-927 — the recheck could not mint a token for an installation GitHub
   * still reports active. Stamps the start of the failure run on rows that
   * have none, and returns the earliest start on record (rows of one
   * installation share its token, so they share the failure).
   */
  async markTokenFailing(installationId: number, at: Date) {
    await prisma.gitHubAppInstallation.updateMany({
      where: { installationId, tokenFailingSince: null },
      data: { tokenFailingSince: at },
    })
    const first = await prisma.gitHubAppInstallation.findFirst({
      where: { installationId, tokenFailingSince: { not: null } },
      orderBy: { tokenFailingSince: 'asc' },
      select: { tokenFailingSince: true },
    })
    return first?.tokenFailingSince ?? at
  },

  /** LUM-927 — a token was minted: the failure run, if any, is over. */
  async clearTokenFailing(installationId: number) {
    await prisma.gitHubAppInstallation.updateMany({
      where: { installationId, tokenFailingSince: { not: null } },
      data: { tokenFailingSince: null },
    })
  },
}
