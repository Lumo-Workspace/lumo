import { miscRepository } from '@/lib/repositories/misc.repository'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import {
  DEFAULT_REPO_REVIEW_SETTING,
  type RepoReviewSettingValues,
} from '@/ee/security/security-scan/auto-review-policy'
import {
  normalizePathInstructions,
  normalizeToneInstructions,
  type PathInstruction,
} from '@/ee/security/security-scan/path-instructions'
import type { ReviewProfile } from '@/ee/security/security-scan/review-profile'

/**
 * LUM-1133 — per-repository automatic review settings
 * (auto-review filters): whether PRs without a Lumo task are reviewed
 * automatically, and whether drafts are. Shared by the settings card and
 * `lumo workspace security-scan --repo`. Any member reads; OWNER changes.
 */

export interface RepoReviewSettingView extends RepoReviewSettingValues {
  /** `owner/name` as the workspace confirmed it. */
  repo: string
}

export interface RepoReviewSettings {
  /** Every repository the workspace confirmed, with its setting. */
  repositories: RepoReviewSettingView[]
  canEdit: boolean
}

export interface RepoReviewSettingsCaller {
  workspaceId: string
  memberId: string
}

export interface RepoReviewSettingsUpdate {
  repo: string
  autoReview?: boolean | undefined
  reviewDrafts?: boolean | undefined
  /** LUM-1143 filters: a list replaces the stored one ([] clears). */
  baseBranches?: string[] | undefined
  labels?: string[] | undefined
  ignoreTitleKeywords?: string[] | undefined
  ignoreUsernames?: string[] | undefined
  /** '' or null clears. */
  descriptionKeyword?: string | null | undefined
  pathFilters?: string[] | undefined
  /** LUM-1147 review style: the list replaces the stored one ([] clears). */
  pathInstructions?: PathInstruction[] | undefined
  reviewProfile?: ReviewProfile | undefined
  /** '' or null clears. */
  toneInstructions?: string | null | undefined
}

type SettingKey = keyof RepoReviewSettingValues

const LIST_KEYS = [
  'baseBranches',
  'labels',
  'ignoreTitleKeywords',
  'ignoreUsernames',
  'pathFilters',
] as const satisfies readonly SettingKey[]

/** Trimmed, without blanks, first occurrence kept. */
export function normalizeFilterList(list: readonly string[]): string[] {
  return [...new Set(list.map(v => v.trim()).filter(v => v.length > 0))]
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length &&
      a.every((v, i) =>
        typeof v === 'object' && v !== null
          ? JSON.stringify(v) === JSON.stringify(b[i])
          : v === b[i]
      )
    )
  return a === b
}

/** PURE — the settings after `update`, from `from`. */
export function applyRepoReviewUpdate(
  from: RepoReviewSettingValues,
  update: RepoReviewSettingsUpdate
): RepoReviewSettingValues {
  const to: RepoReviewSettingValues = {
    ...from,
    autoReview: update.autoReview ?? from.autoReview,
    reviewDrafts: update.reviewDrafts ?? from.reviewDrafts,
    reviewProfile: update.reviewProfile ?? from.reviewProfile,
  }
  for (const key of LIST_KEYS) {
    const next = update[key]
    if (next !== undefined) to[key] = normalizeFilterList(next)
  }
  if (update.descriptionKeyword !== undefined) {
    const k = update.descriptionKeyword?.trim() ?? ''
    to.descriptionKeyword = k.length > 0 ? k : null
  }
  if (update.pathInstructions !== undefined)
    to.pathInstructions = normalizePathInstructions(update.pathInstructions)
  if (update.toneInstructions !== undefined)
    to.toneInstructions = normalizeToneInstructions(update.toneInstructions)
  return to
}

/** PURE — the keys whose value differs, with their new value. */
export function changedRepoReviewValues(
  from: RepoReviewSettingValues,
  to: RepoReviewSettingValues
): Partial<RepoReviewSettingValues> {
  const changed: Partial<RepoReviewSettingValues> = {}
  for (const key of Object.keys(to) as SettingKey[]) {
    if (!sameValue(from[key], to[key]))
      (changed as Record<SettingKey, unknown>)[key] = to[key]
  }
  return changed
}

async function confirmedRepositories(workspaceId: string): Promise<string[]> {
  const row = await githubAppInstallationRepository.findByWorkspace(workspaceId)
  return row?.repositories ?? []
}

async function settingsByRepo(workspaceId: string) {
  const rows = await repoReviewSettingRepository.findForWorkspace(workspaceId)
  return new Map<string, RepoReviewSettingValues>(
    rows.map(({ repo, ...values }) => [
      repo,
      { ...DEFAULT_REPO_REVIEW_SETTING, ...values },
    ])
  )
}

export const repoReviewSettingsService = {
  async list(caller: RepoReviewSettingsCaller): Promise<RepoReviewSettings> {
    const [repos, stored, role] = await Promise.all([
      confirmedRepositories(caller.workspaceId),
      settingsByRepo(caller.workspaceId),
      miscRepository.findMemberRoleById(caller.memberId),
    ])
    return {
      canEdit: role === 'OWNER',
      repositories: repos.map(repo => ({
        repo,
        ...(stored.get(repo.toLowerCase()) ?? DEFAULT_REPO_REVIEW_SETTING),
      })),
    }
  },

  /** OWNER only; the repository must be one the workspace confirmed. */
  async update(
    caller: RepoReviewSettingsCaller,
    update: RepoReviewSettingsUpdate,
    audit: AuditContext
  ): Promise<RepoReviewSettings> {
    const role = await miscRepository.findMemberRoleById(caller.memberId)
    if (role !== 'OWNER') {
      throw Object.assign(
        new Error(
          'Only workspace owners can change repository review settings'
        ),
        { status: 403 }
      )
    }
    const repoLower = update.repo.toLowerCase()
    const repo = (await confirmedRepositories(caller.workspaceId)).find(
      r => r.toLowerCase() === repoLower
    )
    if (!repo) {
      throw Object.assign(
        new Error(
          `Repository ${update.repo} is not connected to this workspace`
        ),
        { status: 404 }
      )
    }
    const from =
      (await settingsByRepo(caller.workspaceId)).get(repoLower) ??
      DEFAULT_REPO_REVIEW_SETTING
    const to = applyRepoReviewUpdate(from, update)
    const changed = changedRepoReviewValues(from, to)
    if (Object.keys(changed).length > 0) {
      await repoReviewSettingRepository.upsert(
        caller.workspaceId,
        repoLower,
        to,
        changed
      )
      await recordAuditEvent({
        workspaceId: caller.workspaceId,
        action: 'repository.review_settings_updated',
        target: { type: 'repository', id: repoLower },
        metadata: { repo, from: { ...from }, to },
        context: audit,
      })
    }
    return this.list(caller)
  },
}
