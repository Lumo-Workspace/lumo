import { waitUntil } from '@/lib/runtime/wait-until'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prReviewControlRepository } from '@/ee/security/repositories/pr-review-control.repository'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import { reviewBudgetView } from '@/ee/security/security-scan/review-control'
import { dispatchPrSecurityScan } from './pr-security-scan-dispatch'
import { prCommitCountBestEffort } from './pr-commit-count'

export const prReviewControlService = {
  async act(
    workspaceId: string,
    number: number,
    repo: string | undefined,
    action: 'pause' | 'resume' | 'incremental' | 'full',
    limit?: number
  ) {
    if (limit !== undefined && action !== 'pause' && action !== 'resume')
      throw Object.assign(
        new Error('limit is only valid with pause or resume'),
        { status: 400 }
      )
    const prs = await pullRequestRepository.findByNumberInWorkspace(
      workspaceId,
      number,
      repo ?? null
    )
    if (prs.length !== 1)
      throw Object.assign(
        new Error(prs.length ? 'Specify repo' : 'PR not found'),
        { status: prs.length ? 409 : 404 }
      )
    const pr = prs[0]!
    if (pr.state !== 'open')
      throw Object.assign(new Error('PR must be open'), { status: 409 })
    if (action === 'pause' || action === 'resume') {
      // LUM-1137: resume baselines the budget at the PR's current commit
      // count, so the next push is charged only for the commits it adds. A
      // stored head GitHub has moved past reads as unknown: no baseline, and
      // the next head counts one commit.
      const commitsAtResume =
        action === 'resume' && pr.headSha
          ? await prCommitCountBestEffort(
              { workspaceId, repo: pr.repo, number: pr.number },
              pr.headSha
            )
          : null
      await prReviewControlRepository.update(
        pr.id,
        action,
        limit,
        commitsAtResume
      )
      // LUM-1137: the budget as the readouts show it (PR limit, else the
      // workspace's pause-after; 0 = never pauses).
      const [control, workspaceLimit] = await Promise.all([
        prReviewControlRepository.get(pr.id),
        securityColumnsRepository.findReviewAutoPauseAfter(workspaceId),
      ])
      return reviewBudgetView(control, workspaceLimit)
    }
    waitUntil(dispatchPrSecurityScan(pr.id, 'PR_EVENT', action))
    return { queued: true, mode: action }
  },
}
