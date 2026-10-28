/**
 * LUM-1334 — records the GitHub reviews the DONE gate's review requirement
 * reads. Only human APPROVED / CHANGES_REQUESTED / DISMISSED reviews are kept:
 * a COMMENTED review neither grants nor withdraws an approval, and a bot's
 * approval is not a review by a person.
 */
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import {
  pullRequestReviewRepository,
  type PullRequestReviewWrite,
} from '@/lib/repositories/pull-request-review.repository'

const STORED_STATES: Record<string, PullRequestReviewWrite['state']> = {
  approved: 'APPROVED',
  changes_requested: 'CHANGES_REQUESTED',
  dismissed: 'DISMISSED',
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * The review write a `pull_request_review` payload carries, or null when it
 * is not one we store (commented, a bot, a malformed payload).
 */
export function parseReviewPayload(payload: Record<string, unknown>):
  | (Omit<PullRequestReviewWrite, 'pullRequestId'> & {
      repo: string
      prNumber: number
    })
  | null {
  const review = payload.review
  const pr = payload.pull_request
  const repo = isRecord(payload.repository)
    ? payload.repository.full_name
    : undefined
  if (!isRecord(review) || !isRecord(pr) || typeof repo !== 'string')
    return null
  if (typeof pr.number !== 'number') return null
  const state =
    typeof review.state === 'string'
      ? STORED_STATES[review.state.toLowerCase()]
      : undefined
  if (!state) return null
  const user = isRecord(review.user) ? review.user : null
  if (!user || typeof user.login !== 'string' || user.type === 'Bot')
    return null
  const id = review.id
  if (typeof id !== 'number' && typeof id !== 'string') return null
  if (typeof review.commit_id !== 'string' || review.commit_id === '')
    return null
  const submittedAt =
    typeof review.submitted_at === 'string'
      ? new Date(review.submitted_at)
      : null
  if (!submittedAt || Number.isNaN(submittedAt.getTime())) return null
  return {
    repo,
    prNumber: pr.number,
    githubReviewId: String(id),
    reviewerLogin: user.login,
    state,
    commitSha: review.commit_id,
    submittedAt,
  }
}

export const pullRequestReviewService = {
  /** Store one `pull_request_review` delivery for one workspace's PR row. */
  async recordFromWebhook(
    payload: Record<string, unknown>,
    workspaceId: string
  ): Promise<boolean> {
    const parsed = parseReviewPayload(payload)
    if (!parsed) return false
    const { repo, prNumber, ...review } = parsed
    const pr = await pullRequestRepository.findByRepoAndNumber(
      workspaceId,
      repo,
      prNumber
    )
    if (!pr) return false
    await pullRequestReviewRepository.upsert({
      ...review,
      pullRequestId: pr.id,
    })
    return true
  },
}
