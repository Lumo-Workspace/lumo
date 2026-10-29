import type { Prisma } from '@prisma/client'
import { GITHUB_PROVIDER } from '@/lib/integrations/git-provider'
import { prisma } from '@/lib/db/prisma'
import {
  parseEmptyBaseBranchesMeans,
  type RepoReviewSettingValues,
} from '@/ee/security/security-scan/auto-review-policy'
import { parsePreMergeChecksSetting } from '@/ee/security/security-scan/pre-merge-checks'
import { normalizePathInstructions } from '@/ee/security/security-scan/path-instructions'
import { parseReviewProfile } from '@/ee/security/security-scan/review-profile'
import { parseHighLevelSummary } from '@/ee/security/security-scan/pr-description-summary'

type StoredColumns =
  | 'emptyBaseBranchesMeans'
  | 'pathInstructions'
  | 'reviewProfile'
  | 'toneInstructions'
  | 'preMergeChecks'
  | 'highLevelSummary'

/** The stored text / Json columns as the domain types. */
function toDomain<
  T extends {
    emptyBaseBranchesMeans: string
    pathInstructions: unknown
    reviewProfile: string
    toneInstructions: string | null
    preMergeChecks: unknown
    highLevelSummary: string
  },
>(
  row: T
): Omit<T, StoredColumns> & Pick<RepoReviewSettingValues, StoredColumns> {
  return {
    ...row,
    emptyBaseBranchesMeans: parseEmptyBaseBranchesMeans(
      row.emptyBaseBranchesMeans
    ),
    // LUM-1147: a Json column — anything malformed reads as no entry.
    pathInstructions: normalizePathInstructions(row.pathInstructions),
    reviewProfile: parseReviewProfile(row.reviewProfile),
    toneInstructions: row.toneInstructions,
    // LUM-1148: null (never set) or malformed reads as the defaults.
    preMergeChecks: parsePreMergeChecksSetting(row.preMergeChecks),
    highLevelSummary: parseHighLevelSummary(row.highLevelSummary),
  }
}

/** The domain values as columns (the Json values as Prisma input). */
function toColumns<V extends Partial<RepoReviewSettingValues>>(
  values: V
): Omit<V, 'pathInstructions' | 'preMergeChecks'> & {
  pathInstructions?: Prisma.InputJsonValue
  preMergeChecks?: Prisma.InputJsonValue
} {
  const { pathInstructions, preMergeChecks, ...rest } = values
  return {
    ...rest,
    ...(pathInstructions !== undefined
      ? {
          pathInstructions:
            pathInstructions as unknown as Prisma.InputJsonValue,
        }
      : {}),
    // LUM-1148: the pre-merge checks are one Json value.
    ...(preMergeChecks !== undefined
      ? { preMergeChecks: preMergeChecks as unknown as Prisma.InputJsonValue }
      : {}),
  }
}

/** LUM-1143: every stored setting column (filters included). */
const SETTING_SELECT = {
  autoReview: true,
  reviewDrafts: true,
  baseBranches: true,
  emptyBaseBranchesMeans: true,
  labels: true,
  ignoreTitleKeywords: true,
  ignoreUsernames: true,
  descriptionKeyword: true,
  pathFilters: true,
  preMergeChecks: true,
  pathInstructions: true,
  reviewProfile: true,
  toneInstructions: true,
  highLevelSummary: true,
  sequenceDiagrams: true,
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
    const rows = await prisma.repositoryReviewSetting.findMany({
      where: { workspaceId: { in: workspaceIds }, repo: repoLower },
      select: { workspaceId: true, ...SETTING_SELECT },
    })
    return (rows ?? []).map(toDomain)
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

  /**
   * LUM-1147: one workspace's review style for a repository (null = no
   * stored row), for the scan worker's review input.
   */
  async findReviewStyle(
    workspaceId: string,
    repoLower: string
  ): Promise<Pick<
    RepoReviewSettingValues,
    | 'pathInstructions'
    | 'reviewProfile'
    | 'toneInstructions'
    | 'highLevelSummary'
    | 'sequenceDiagrams'
  > | null> {
    const row = await prisma.repositoryReviewSetting.findUnique({
      where: { workspaceId_repo: { workspaceId, repo: repoLower } },
      select: {
        pathInstructions: true,
        reviewProfile: true,
        toneInstructions: true,
        highLevelSummary: true,
        sequenceDiagrams: true,
      },
    })
    if (!row) return null
    return {
      pathInstructions: normalizePathInstructions(row.pathInstructions),
      reviewProfile: parseReviewProfile(row.reviewProfile),
      toneInstructions: row.toneInstructions,
      // LUM-1151: where the high-level summary goes.
      highLevelSummary: parseHighLevelSummary(row.highLevelSummary),
      // LUM-1155: the call-flow diagram switch.
      sequenceDiagrams: row.sequenceDiagrams,
    }
  },

  /** Every stored setting of one workspace. */
  async findForWorkspace(workspaceId: string) {
    const rows = await prisma.repositoryReviewSetting.findMany({
      where: { workspaceId },
      select: { repo: true, ...SETTING_SELECT },
    })
    return (rows ?? []).map(toDomain)
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
      create: { workspaceId, repo: repoLower, ...toColumns(values) },
      update: toColumns(changed),
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
        provider: GITHUB_PROVIDER,
        repo: { equals: repoLower, mode: 'insensitive' },
        number,
        taskId: { not: null },
      },
      select: { id: true },
    })
    return row !== null
  },
}
