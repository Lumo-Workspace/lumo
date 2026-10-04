import type { Prisma } from '@prisma/client'
import { logger } from '@/lib/logger'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'
import { storedRepoSpellings } from '@/lib/repositories/repo-spellings'
import { stripCodeBlocksFromCommentHtml } from '@/lib/integrations/github/mirror-code-strip'
import { buildPurgedDeadLetterPayload } from '@/lib/integrations/github/dead-letter-retention'
import { isConfirmedRepository } from '@/lib/integrations/github/confirmed-repositories'

/**
 * LUM-879 — PR comments mirrored from GitHub are team discussion, but a
 * review comment can carry the repository's code (a ```` ```suggestion ````
 * block, a quoted snippet). When a repository leaves the workspace, that code
 * goes like the scan code does: the code blocks are stripped from the
 * comment, its text, author and timestamps stay. The sync jobs queued for the
 * repository's PRs still hold GitHub's raw webhook payload; they can no
 * longer run, so they are retired with the payload reduced to metadata.
 */

export interface CommentScrubCounts {
  comments: number
  jobs: number
}

/** Which of the workspace's unpurged jobs belong to these PRs / comments. */
function jobBelongs(
  job: { commentId: string | null; payload: unknown },
  pullRequestIds: Set<string>,
  commentIds: Set<string>
): boolean {
  if (job.commentId && commentIds.has(job.commentId)) return true
  const payload = job.payload as { pullRequestId?: unknown } | null
  return (
    typeof payload?.pullRequestId === 'string' &&
    pullRequestIds.has(payload.pullRequestId)
  )
}

async function stripComment(row: {
  commentId: string
  comment: { body: string; updatedAt: Date }
}): Promise<boolean> {
  const stripped = stripCodeBlocksFromCommentHtml(row.comment.body)
  if (stripped === row.comment.body) return false
  return commentRepository.replaceBodyKeepingUpdatedAt(
    row.commentId,
    row.comment,
    stripped
  )
}

/**
 * Strip the code from the workspace's mirrored comments on PRs of `repos`
 * (every PR of the workspace when omitted: an uninstall) and retire the sync
 * jobs queued for them. Idempotent: a stripped body has no block left, a
 * purged job is skipped.
 */
export async function scrubMirroredCommentCode(
  workspaceId: string,
  reason: string,
  repos?: string[]
): Promise<CommentScrubCounts> {
  const spellings = repos
    ? await storedRepoSpellings(workspaceId, repos)
    : undefined
  if (spellings && spellings.length === 0) return { comments: 0, jobs: 0 }

  const mirrored = await prCommentMirrorRepository.findMirroredCommentBodies(
    workspaceId,
    spellings
  )
  let comments = 0
  for (const row of mirrored) {
    if (await stripComment(row)) comments++
  }

  const pullRequestIds = new Set(mirrored.map(row => row.pullRequestId))
  const commentIds = new Set(mirrored.map(row => row.commentId))
  if (spellings) {
    // A queued inbound job can be the PR's first comment: no mirror yet.
    for (const id of await pullRequestRepository.findIdsByRepos(
      workspaceId,
      spellings
    )) {
      pullRequestIds.add(id)
    }
  }
  const jobs =
    await prCommentSyncJobRepository.findUnpurgedForWorkspace(workspaceId)
  const now = new Date()
  let retired = 0
  for (const job of jobs) {
    if (spellings && !jobBelongs(job, pullRequestIds, commentIds)) continue
    const purged = await prCommentSyncJobRepository.retireWithPurgedPayload(
      job.id,
      buildPurgedDeadLetterPayload(
        job.payload
      ) as unknown as Prisma.InputJsonValue,
      now,
      `repository left the workspace: ${reason}`
    )
    if (purged) retired++
  }
  return { comments, jobs: retired }
}

/**
 * LUM-879 — the comment-side twin of `scrubScanIfRepositoryUnconfirmed`
 * (LUM-896): an inbound mirror write was routed while its repository was
 * confirmed, but the list may have narrowed — and the repository's comments
 * been scrubbed — before the write landed. Re-read the list after the write
 * and, when the repository is gone, scrub it again (the comment just written
 * and any job it queued). A narrowing that commits before this read is seen
 * here; one that commits after it runs its own after-narrowing scrub, which
 * sees this comment.
 *
 * Best effort, like its twin: the write has landed, so a failure is logged.
 */
export async function scrubCommentsIfRepositoryUnconfirmed(
  pullRequestId: string
): Promise<boolean> {
  try {
    const scope = await pullRequestRepository.findRepoScope(pullRequestId)
    if (!scope) return false
    const installation = await githubAppInstallationRepository.findByWorkspace(
      scope.workspaceId
    )
    if (
      installation &&
      isConfirmedRepository(installation.repositories, scope.repo)
    )
      return false
    const counts = await scrubMirroredCommentCode(
      scope.workspaceId,
      'mirrored after the repository left the confirmed list',
      [scope.repo]
    )
    logger.info(
      `[pr-mirror] PR ${pullRequestId}: repository no longer confirmed for workspace ${scope.workspaceId}; stripped ${counts.comments} comment(s), retired ${counts.jobs} job(s)`
    )
    return true
  } catch (error) {
    logger.error(
      `[pr-mirror] PR ${pullRequestId}: confirmed-list recheck failed: ${String(error)}`
    )
    return false
  }
}
