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

/**
 * LUM-1133 — per-repository automatic review settings (CodeRabbit
 * `reviews.auto_review`): whether PRs without a Lumo task are reviewed
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
}

async function confirmedRepositories(workspaceId: string): Promise<string[]> {
  const row = await githubAppInstallationRepository.findByWorkspace(workspaceId)
  return row?.repositories ?? []
}

async function settingsByRepo(workspaceId: string) {
  const rows = await repoReviewSettingRepository.findForWorkspace(workspaceId)
  return new Map(
    rows.map(r => [
      r.repo,
      { autoReview: r.autoReview, reviewDrafts: r.reviewDrafts },
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
    const to: RepoReviewSettingValues = {
      autoReview: update.autoReview ?? from.autoReview,
      reviewDrafts: update.reviewDrafts ?? from.reviewDrafts,
    }
    if (
      to.autoReview !== from.autoReview ||
      to.reviewDrafts !== from.reviewDrafts
    ) {
      await repoReviewSettingRepository.upsert(
        caller.workspaceId,
        repoLower,
        to
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
