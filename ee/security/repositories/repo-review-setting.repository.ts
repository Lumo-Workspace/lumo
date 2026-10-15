import { prisma } from '@/lib/db/prisma'
import type { RepoReviewSettingValues } from '@/ee/security/security-scan/auto-review-policy'

/** LUM-1143: every stored setting column (filters included). */
const SETTING_SELECT = {
  autoReview: true,
  reviewDrafts: true,
  baseBranches: true,
  labels: true,
  ignoreTitleKeywords: true,
  ignoreUsernames: true,
  descriptionKeyword: true,
  pathFilters: true,
} as const

/**
 * LUM-1133 — per-repository automatic review settings and the cross-workspace
 * reads the task-less review decision needs. Repository names are compared
 * lower-cased (GitHub names are case-insensitive); settings rows store them
 * lower-cased.
 */
export interface ConfirmingWorkspaceRow {
  workspaceId: string
  confirmedAt: Date
}

export interface RepoReviewSettingRow extends RepoReviewSettingValues {
  workspaceId: string
}

export const repoReviewSettingRepository = {
  /**
   * Every workspace whose confirmed GitHub App list holds the repository,
   * with when its App row was created (cross-tenant on purpose: deciding
   * which ONE workspace reviews a shared repository needs all of them).
   * Filtered in the database on the name as GitHub sends it (its canonical
   * casing, which is also how confirmations are stored) or lower-cased, then
   * matched case-insensitively — never a scan of every installation.
   */
  async findConfirmingWorkspaces(
    repo: string
  ): Promise<ConfirmingWorkspaceRow[]> {
    const repoLower = repo.toLowerCase()
    const rows = await prisma.gitHubAppInstallation.findMany({
      where: { repositories: { hasSome: [...new Set([repo, repoLower])] } },
      select: { workspaceId: true, repositories: true, createdAt: true },
    })
    return rows
      .filter(r => r.repositories.some(n => n.toLowerCase() === repoLower))
      .map(r => ({ workspaceId: r.workspaceId, confirmedAt: r.createdAt }))
  },

  async findSettings(
    workspaceIds: string[],
    repoLower: string
  ): Promise<RepoReviewSettingRow[]> {
    if (workspaceIds.length === 0) return []
    return prisma.repositoryReviewSetting.findMany({
      where: { workspaceId: { in: workspaceIds }, repo: repoLower },
      select: { workspaceId: true, ...SETTING_SELECT },
    })
  },

  /**
   * LUM-1143: one workspace's path filters for a repository ([] = none
   * stored), for the scan worker's review input.
   */
  async findPathFilters(
    workspaceId: string,
    repoLower: string
  ): Promise<string[]> {
    const row = await prisma.repositoryReviewSetting.findUnique({
      where: { workspaceId_repo: { workspaceId, repo: repoLower } },
      select: { pathFilters: true },
    })
    return row?.pathFilters ?? []
  },

  /** Every stored setting of one workspace. */
  async findForWorkspace(workspaceId: string) {
    return prisma.repositoryReviewSetting.findMany({
      where: { workspaceId },
      select: { repo: true, ...SETTING_SELECT },
    })
  },

  /**
   * `values` creates a missing row; an existing row gets only `changed`, so
   * two owners changing different switches at once do not undo each other.
   */
  async upsert(
    workspaceId: string,
    repoLower: string,
    values: RepoReviewSettingValues,
    changed: Partial<RepoReviewSettingValues> = values
  ) {
    return prisma.repositoryReviewSetting.upsert({
      where: { workspaceId_repo: { workspaceId, repo: repoLower } },
      create: { workspaceId, repo: repoLower, ...values },
      update: changed,
      select: { repo: true, ...SETTING_SELECT },
    })
  },

  /** Whether another workspace holds this PR linked to one of its tasks. */
  async isLinkedElsewhere(
    workspaceId: string,
    repoLower: string,
    number: number
  ): Promise<boolean> {
    const row = await prisma.pullRequest.findFirst({
      where: {
        workspaceId: { not: workspaceId },
        repo: { equals: repoLower, mode: 'insensitive' },
        number,
        taskId: { not: null },
      },
      select: { id: true },
    })
    return row !== null
  },
}
