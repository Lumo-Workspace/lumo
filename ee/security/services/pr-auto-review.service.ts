/**
 * LUM-1133 — whether a PR without a Lumo task is reviewed automatically on
 * this pull_request event, and if so, dispatches the scan. Loads the inputs
 * of the pure decision (ee/security/security-scan/auto-review-policy.ts).
 * Never throws: a failure is logged and the PR is simply not reviewed on
 * this event (the next push tries again; `lumo pr review` reviews by hand).
 */
import { logger } from '@/lib/logger'
import {
  repoReviewSettingRepository,
  type RepoReviewSettingRow,
} from '@/ee/security/repositories/repo-review-setting.repository'
import {
  DEFAULT_REPO_REVIEW_SETTING,
  decideTasklessAutoReview,
  isFilterChangeEvent,
  type RepoReviewSettingValues,
  type TasklessReviewDecision,
} from '@/ee/security/security-scan/auto-review-policy'
import type { PullRequestReviewFacts } from '@/lib/plugins/types'
import {
  dispatchPrSecurityScan,
  shouldScanOnPrEvent,
} from '@/ee/security/services/pr-security-scan-dispatch'
import { repoConfigService } from '@/ee/security/services/repo-config.service'
import { reviewSettingsWithFile } from '@/ee/security/security-scan/repo-config'

export interface TasklessPrEvent {
  workspaceId: string
  pullRequestId: string
  action: string
  state: string
  repo: string
  prNumber: number
  isDraft: boolean
  /** LUM-1143: what the repository's filters read (absent = filter nothing). */
  reviewFacts?: PullRequestReviewFacts | undefined
  /** LUM-1143: labeled / unlabeled / edited — the facts before the change. */
  reviewFactsBefore?: PullRequestReviewFacts | undefined
  /** LUM-1146: the base commit, where `.lumo.yaml` is read (absent = not read). */
  baseSha?: string | null | undefined
}

/** A stored row over the defaults (a column it lacks keeps its default). */
function settingOf(row: RepoReviewSettingRow): RepoReviewSettingValues {
  const setting: RepoReviewSettingValues = { ...DEFAULT_REPO_REVIEW_SETTING }
  for (const key of Object.keys(setting) as (keyof RepoReviewSettingValues)[])
    if (row[key] !== undefined)
      (setting as unknown as Record<string, unknown>)[key] = row[key]
  return setting
}

export async function decideTasklessReview(
  event: TasklessPrEvent
): Promise<TasklessReviewDecision> {
  // Cheap exit before any read: most PR events are not review events.
  // LUM-1143: a label / title / description / base change may newly let
  // the PR through the repository's filters.
  const filterChange =
    isFilterChangeEvent(event.action, event.state) &&
    event.reviewFactsBefore !== undefined
  if (!shouldScanOnPrEvent(event.action, event.state) && !filterChange)
    return { review: false, reason: 'not_a_review_event' }
  const repoLower = event.repo.toLowerCase()
  const workspaces = await repoReviewSettingRepository.findConfirmingWorkspaces(
    event.repo
  )
  // LUM-1146: the repository's `.lumo.yaml` on the PR's BASE commit wins
  // over each workspace's stored settings (never the PR's own copy, so a PR
  // cannot exempt itself). Absent / invalid / unreadable = settings only.
  const [settings, linkedElsewhere, file] = await Promise.all([
    repoReviewSettingRepository.findSettings(
      workspaces.map(w => w.workspaceId),
      repoLower
    ),
    workspaces.length > 1
      ? repoReviewSettingRepository.isLinkedElsewhere(
          event.workspaceId,
          repoLower,
          event.prNumber
        )
      : Promise.resolve(false),
    workspaces.some(w => w.workspaceId === event.workspaceId)
      ? repoConfigService.fileForDecision({
          workspaceId: event.workspaceId,
          repo: event.repo,
          baseSha: event.baseSha,
        })
      : Promise.resolve(null),
  ])
  const byWorkspace = new Map(settings.map(s => [s.workspaceId, s]))
  return decideTasklessAutoReview({
    action: event.action,
    state: event.state,
    isDraft: event.isDraft,
    pr: event.reviewFacts,
    before: event.reviewFactsBefore,
    workspaceId: event.workspaceId,
    linkedElsewhere,
    confirming: workspaces.map(w => {
      const s = byWorkspace.get(w.workspaceId)
      return {
        workspaceId: w.workspaceId,
        confirmedAt: w.confirmedAt,
        setting: reviewSettingsWithFile(
          s ? settingOf(s) : { ...DEFAULT_REPO_REVIEW_SETTING },
          file
        ),
      }
    }),
  })
}

export async function reviewTasklessPullRequest(
  event: TasklessPrEvent
): Promise<void> {
  try {
    const decision = await decideTasklessReview(event)
    if (!decision.review) {
      if (decision.reason !== 'not_a_review_event')
        logger.info(
          `[pr-auto-review] not reviewing pr=${event.pullRequestId} (${event.action}): ${decision.reason}`
        )
      return
    }
    await dispatchPrSecurityScan(event.pullRequestId, 'PR_EVENT')
  } catch (error) {
    logger.warn(
      `[pr-auto-review] decision failed pr=${event.pullRequestId}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
