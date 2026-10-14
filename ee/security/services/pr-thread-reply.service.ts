/**
 * LUM-1131 — a human reply in one of Lumo's finding threads (CodeRabbit
 * "learnings" parity).
 *
 *   · Lumo answers a trusted human's reply once, with a short templated
 *     comment — the reply's text never reaches what Lumo posts, except as
 *     the cleaned learning sentence it echoes back.
 *   · A reply that says the finding is intentional / not applicable (the
 *     deterministic gate AND the model agree) closes that thread for this
 *     PR and, for an AI-review finding, stores a learning: a PROJECT
 *     CONVENTION memory (read / edited / deleted in the memory UI) plus its
 *     repository scope, which later AI reviews of the repository read.
 *   · Nothing else can happen. A reply never dispositions a finding: a
 *     gate-blocking one keeps blocking DONE until the user rules on it
 *     (`lumo finding disposition` / web panel), and the answer says so.
 *
 * Ignored outright: edits and deletions, top-level comments, bots (Lumo's own
 * answers come back as webhooks), replies outside a Lumo finding thread, and
 * authors LUM-1003 does not trust (not a workspace member, not the repo's
 * owner or a collaborator).
 *
 * Best effort: every GitHub / model / storage failure is logged; nothing is
 * thrown at the webhook.
 */
import { logger } from '@/lib/logger'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { reviewThreadClient } from '@/lib/integrations/github/review-threads'
import { githubRepository } from '@/lib/repositories/github.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { memoryManagementService } from '@/lib/services/memory-management.service'
import {
  guardInjectedText,
  guardPromptLineText,
} from '@/lib/security-scan/inject-guard'
import {
  prFindingThreadRepository,
  type FindingThreadRow,
} from '@/ee/security/repositories/pr-finding-thread.repository'
import { prReviewLearningRepository } from '@/ee/security/repositories/pr-review-learning.repository'
import {
  prSecurityScanRepository,
  type FindingRow,
} from '@/ee/security/repositories/pr-security-scan.repository'
import {
  isBlockingFinding,
  loadSecurityPolicy,
} from '@/ee/security/services/pr-security-scan-gate'
import {
  isLumoActor,
  layerOf,
} from '@/ee/security/services/pr-finding-thread.service'
import {
  buildAckReply,
  buildLearningReply,
  buildScannerReply,
  canTeach,
  decideLearning,
  normalizePathGlob,
  screenReply,
} from '@/ee/security/security-scan/thread-reply'
import type { ThreadReplyVerdict } from '@/ee/security/llm/thread-reply-client'

export interface ThreadReplyEvent {
  workspaceId: string
  pullRequestId: string
  taskId: string | null
  repo: string
  prNumber: number
  action: string
  comment: {
    id: number
    body: string
    inReplyToId: number | null
    user: { login?: string; type?: string } | null
    authorAssociation: string | null
  }
}

export type ThreadReplyOutcome =
  | 'ignored_action'
  | 'ignored_bot'
  | 'not_lumo_thread'
  | 'ignored_untrusted'
  | 'duplicate'
  | 'acknowledged'
  | 'closed_scanner'
  | 'learning_added'
  | 'closed_no_learning'
  | 'failed'

/** The model's answer, or null when it could not be had (never thrown). */
async function askModel(
  finding: { ruleId: string; title: string; filePath: string },
  body: string
): Promise<ThreadReplyVerdict | null> {
  try {
    const { classifyThreadReply } =
      await import('@/ee/security/llm/thread-reply-client')
    const guarded = guardInjectedText(body)
    return await classifyThreadReply({
      finding: {
        ruleId: guardPromptLineText(finding.ruleId),
        title: guardPromptLineText(finding.title),
        filePath: guardPromptLineText(finding.filePath),
      },
      reply: { text: guarded.text, notices: guarded.notices },
    })
  } catch (error) {
    logger.warn(
      `[pr-thread-reply] classifier unavailable: ${error instanceof Error ? error.message : String(error)}`
    )
    return null
  }
}

/** The finding behind the thread on the PR's latest scan, if still there. */
async function latestFinding(
  pullRequestId: string,
  fingerprint: string
): Promise<FindingRow | null> {
  const [scan] = await prSecurityScanRepository.findLatestByPullRequestIds([
    pullRequestId,
  ])
  return scan?.findings.find(f => f.fingerprint === fingerprint) ?? null
}

async function blockingFindingId(
  workspaceId: string,
  finding: FindingRow | null
): Promise<string | null> {
  if (!finding) return null
  const policy = await loadSecurityPolicy(workspaceId)
  return isBlockingFinding(finding, policy) ? finding.id : null
}

interface GithubCtx {
  repo: { owner: string; name: string }
  prNumber: number
  token: string
}

/** Resolve the thread on GitHub (best effort) and record it as closed by the human. */
async function closeThread(
  gh: GithubCtx,
  row: FindingThreadRow,
  login: string
): Promise<void> {
  try {
    let threadId = row.threadNodeId
    let resolved = false
    if (!threadId) {
      const threads = await reviewThreadClient.listReviewThreads(gh)
      const t = threads.find(x => String(x.firstCommentId) === row.commentId)
      threadId = t?.id ?? null
      resolved = t?.isResolved ?? false
    }
    if (threadId && !resolved)
      await reviewThreadClient.resolveThread({ threadId, token: gh.token })
    await prFindingThreadRepository.update(row.id, {
      state: 'RESOLVED_BY_USER',
      resolvedByLogin: login,
      resolvedAt: new Date(),
      ...(threadId ? { threadNodeId: threadId } : {}),
    })
  } catch (error) {
    logger.warn(
      `[pr-thread-reply] close failed fp=${row.fingerprint}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

async function postReply(
  gh: GithubCtx,
  row: FindingThreadRow,
  body: string
): Promise<void> {
  await prCommentClient.createReviewLineReply({
    repo: gh.repo,
    prNumber: gh.prNumber,
    inReplyTo: Number(row.commentId),
    body,
    token: gh.token,
  })
}

async function projectIdFor(event: ThreadReplyEvent): Promise<string | null> {
  if (event.taskId) {
    const task = await taskRepository.findProjectId(event.taskId)
    if (task?.projectId) return task.projectId
  }
  return projectRepository.findProjectIdByRepoFullName(
    event.workspaceId,
    event.repo
  )
}

/** Store the learning: memory first, then its repository scope. null = not stored. */
async function storeLearning(input: {
  event: ThreadReplyEvent
  row: FindingThreadRow
  login: string
  memberId: string | null
  learning: string
  pathGlob: string | null
}): Promise<boolean> {
  const { event, row, login, learning, pathGlob } = input
  const replyId = String(event.comment.id)
  if (
    await prReviewLearningRepository.findBySourceReply(
      event.workspaceId,
      replyId
    )
  )
    return true
  const projectId = await projectIdFor(event)
  if (!projectId) return false
  const scope = `Lumo AI review of ${event.repo}${pathGlob ? `, files matching ${pathGlob}` : ''} — from @${login}'s reply on ${event.repo}#${event.prNumber} (finding ${row.ruleId})`
  try {
    const memory = await memoryManagementService.createReviewLearning({
      projectId,
      workspaceId: event.workspaceId,
      content: {
        summary: `PR review learning: ${learning.length > 90 ? `${learning.slice(0, 89).trimEnd()}…` : learning}`,
        rule: learning,
        scope,
      },
      actorMemberId: input.memberId,
    })
    await prReviewLearningRepository.create({
      workspaceId: event.workspaceId,
      memoryId: memory.id,
      repo: event.repo,
      pathGlob,
      ruleId: row.ruleId,
      fingerprint: row.fingerprint,
      sourcePullRequestId: event.pullRequestId,
      sourceReplyId: replyId,
      authorLogin: login,
    })
    return true
  } catch (error) {
    logger.warn(
      `[pr-thread-reply] learning not stored pr=${event.pullRequestId}: ${error instanceof Error ? error.message : String(error)}`
    )
    return false
  }
}

export async function applyThreadReply(
  event: ThreadReplyEvent
): Promise<ThreadReplyOutcome> {
  const { comment } = event
  if (event.action !== 'created' || comment.inReplyToId === null)
    return 'ignored_action'
  const login = comment.user?.login ?? null
  if (
    !comment.user ||
    comment.user.type !== 'User' ||
    isLumoActor(comment.user) ||
    !login
  )
    return 'ignored_bot'

  const [row] = await prFindingThreadRepository.findByThreadRef(
    event.pullRequestId,
    { threadNodeId: null, commentIds: [String(comment.inReplyToId)] }
  )
  if (!row) return 'not_lumo_thread'

  const integration = await githubRepository.findIntegrationByLogin(
    event.workspaceId,
    login
  )
  const memberId = integration?.member?.id ?? null
  if (
    !canTeach({
      login,
      type: comment.user.type ?? null,
      authorAssociation: comment.authorAssociation,
      isWorkspaceMember: memberId !== null,
    })
  )
    return 'ignored_untrusted'

  if (!(await prFindingThreadRepository.claimReply(row.id, String(comment.id))))
    return 'duplicate'

  let token: string
  try {
    token = await getRepoToken(
      event.workspaceId,
      event.repo,
      REPO_TOKEN_PERMISSIONS.pullRequestWrite
    )
  } catch (error) {
    logger.warn(
      `[pr-thread-reply] no token for ${event.repo}: ${error instanceof Error ? error.message : String(error)}`
    )
    return 'failed'
  }
  const [owner = '', name = ''] = event.repo.split('/')
  const gh: GithubCtx = {
    repo: { owner, name },
    prNumber: event.prNumber,
    token,
  }

  try {
    const label = screenReply(comment.body)
    if (label !== 'LEARNING') {
      await postReply(gh, row, buildAckReply(label, login))
      return 'acknowledged'
    }

    const finding = await latestFinding(event.pullRequestId, row.fingerprint)
    const blockingId = await blockingFindingId(event.workspaceId, finding)

    // Learnings shape the AI review only: a scanner / hunt finding gets the
    // thread closed and the way to rule it out.
    if (layerOf(row) !== 'judge') {
      await postReply(
        gh,
        row,
        buildScannerReply({ login, blockingFindingId: blockingId })
      )
      await closeThread(gh, row, login)
      return 'closed_scanner'
    }

    const verdict = await askModel(
      {
        ruleId: row.ruleId,
        title: finding?.title ?? row.ruleId,
        filePath: row.filePath,
      },
      comment.body
    )
    const learning = decideLearning(label, verdict)
    if (!learning) {
      await postReply(gh, row, buildAckReply('OTHER', login))
      return 'acknowledged'
    }
    const pathGlob = normalizePathGlob(verdict?.pathGlob, row.filePath)
    const stored = await storeLearning({
      event,
      row,
      login,
      memberId,
      learning,
      pathGlob,
    })
    await postReply(
      gh,
      row,
      buildLearningReply({
        login,
        learning,
        repo: event.repo,
        pathGlob,
        stored,
        blockingFindingId: blockingId,
      })
    )
    await closeThread(gh, row, login)
    return stored ? 'learning_added' : 'closed_no_learning'
  } catch (error) {
    logger.warn(
      `[pr-thread-reply] reply failed pr=${event.pullRequestId} comment=${comment.id}: ${error instanceof Error ? error.message : String(error)}`
    )
    return 'failed'
  }
}
