/**
 * LUM-1133 — whether a PR without a Lumo task is reviewed automatically on
 * this pull_request event, and if so, dispatches the scan. Loads the inputs
 * of the pure decision (ee/security/security-scan/auto-review-policy.ts).
 * Never throws: a failure is logged and the PR is simply not reviewed on
 * this event (the next push tries again; `lumo pr scan` reviews by hand).
 */
import { logger } from '@/lib/logger'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import {
  DEFAULT_REPO_REVIEW_SETTING,
  decideTasklessAutoReview,
  type TasklessReviewDecision,
} from '@/ee/security/security-scan/auto-review-policy'
import {
  dispatchPrSecurityScan,
  shouldScanOnPrEvent,
} from '@/ee/security/services/pr-security-scan-dispatch'

export interface TasklessPrEvent {
  workspaceId: string
  pullRequestId: string
  action: string
  state: string
  repo: string
  prNumber: number
  isDraft: boolean
}

export async function decideTasklessReview(
  event: TasklessPrEvent
): Promise<TasklessReviewDecision> {
  // Cheap exit before any read: most PR events are not review events.
  if (!shouldScanOnPrEvent(event.action, event.state))
    return { review: false, reason: 'not_a_review_event' }
  const repoLower = event.repo.toLowerCase()
  const workspaces =
    await repoReviewSettingRepository.findConfirmingWorkspaces(repoLower)
  const [settings, linkedElsewhere] = await Promise.all([
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
  ])
  const byWorkspace = new Map(settings.map(s => [s.workspaceId, s]))
  return decideTasklessAutoReview({
    action: event.action,
    state: event.state,
    isDraft: event.isDraft,
    workspaceId: event.workspaceId,
    linkedElsewhere,
    confirming: workspaces.map(w => {
      const s = byWorkspace.get(w.workspaceId)
      return {
        workspaceId: w.workspaceId,
        confirmedAt: w.confirmedAt,
        setting: s
          ? { autoReview: s.autoReview, reviewDrafts: s.reviewDrafts }
          : { ...DEFAULT_REPO_REVIEW_SETTING },
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
