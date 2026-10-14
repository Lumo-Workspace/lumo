/**
 * LUM-1133 — automatic review of PRs that have no Lumo task (CodeRabbit
 * `reviews.auto_review` parity). PURE: the service loads the inputs.
 *
 * A task-linked PR keeps its scan regardless of these settings — it is the
 * DONE gate's evidence. A task-less PR is reviewed when:
 *  - the event is one a review runs on (opened / reopened / synchronize /
 *    ready_for_review on an open PR);
 *  - this workspace confirmed the repository (never just because a webhook
 *    arrived — tenant isolation);
 *  - the workspace left automatic review on for the repository;
 *  - the PR is not a draft, unless the repository opted drafts in. A PR
 *    converted back to draft keeps its earlier findings and threads; pushes
 *    while it is a draft are not reviewed, and marking it ready reviews the
 *    then-current head;
 *  - no other workspace holds the PR linked to one of its tasks, and among
 *    the workspaces that confirmed the repository and would review it, this
 *    one confirmed first — so a repository two workspaces share gets one
 *    review on GitHub, not two.
 */
import { shouldScanOnPrEvent } from '@/ee/security/services/pr-security-scan-dispatch'

export interface RepoReviewSettingValues {
  /** Review every PR of the repository automatically. */
  autoReview: boolean
  /** Review draft PRs too (otherwise they wait for ready_for_review). */
  reviewDrafts: boolean
}

/** No stored row = these. */
export const DEFAULT_REPO_REVIEW_SETTING: Readonly<RepoReviewSettingValues> =
  Object.freeze({ autoReview: true, reviewDrafts: false })

export interface ConfirmingWorkspace {
  workspaceId: string
  /** When the workspace's GitHub App row was created (its confirmation). */
  confirmedAt: Date
  setting: RepoReviewSettingValues
}

export type TasklessReviewSkip =
  | 'not_a_review_event'
  | 'repo_not_confirmed'
  | 'repo_off'
  | 'draft'
  | 'linked_elsewhere'
  | 'other_workspace_reviews'

export type TasklessReviewDecision =
  | { review: true }
  | { review: false; reason: TasklessReviewSkip }

export interface TasklessReviewInput {
  action: string
  state: string
  isDraft: boolean
  workspaceId: string
  /** Every workspace whose confirmed list holds the repository. */
  confirming: readonly ConfirmingWorkspace[]
  /** Another workspace holds this PR linked to one of its tasks. */
  linkedElsewhere: boolean
}

function wouldReview(c: ConfirmingWorkspace, isDraft: boolean): boolean {
  return c.setting.autoReview && (!isDraft || c.setting.reviewDrafts)
}

export function decideTasklessAutoReview(
  input: TasklessReviewInput
): TasklessReviewDecision {
  const skip = (reason: TasklessReviewSkip) =>
    ({ review: false, reason }) as const
  if (!shouldScanOnPrEvent(input.action, input.state))
    return skip('not_a_review_event')
  const self = input.confirming.find(c => c.workspaceId === input.workspaceId)
  if (!self) return skip('repo_not_confirmed')
  if (!self.setting.autoReview) return skip('repo_off')
  if (input.isDraft && !self.setting.reviewDrafts) return skip('draft')
  if (input.linkedElsewhere) return skip('linked_elsewhere')
  const reviewer = input.confirming
    .filter(c => wouldReview(c, input.isDraft))
    .sort(
      (a, b) =>
        a.confirmedAt.getTime() - b.confirmedAt.getTime() ||
        (a.workspaceId < b.workspaceId ? -1 : 1)
    )[0]
  if (reviewer?.workspaceId !== input.workspaceId)
    return skip('other_workspace_reviews')
  return { review: true }
}
