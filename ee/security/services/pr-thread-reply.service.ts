/**
 * LUM-1131 — a human reply in one of Lumo's finding threads
 * ("learnings").
 *
 *   · Lumo answers a trusted human's reply once, with a short templated
 *     comment — the reply's text never reaches what Lumo posts, except as
 *     the cleaned learning sentence it echoes back. LUM-1154: a reply that
 *     asks a question (and is not a learning — the gate keeps precedence)
 *     gets a grounded answer from the chat service instead
 *     (`pr-chat.service`), when its author has write access.
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
import { createHash } from 'node:crypto'
import { logger } from '@/lib/logger'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import { reviewThreadClient } from '@/lib/integrations/github/review-threads'
import { githubRepository } from '@/lib/repositories/github.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { projectRepository } from '@/lib/repositories/project.repository'
import { memoryManagementService } from '@/lib/services/memory-management.service'
import { conventionContentSchema } from '@/lib/memory/schemas'
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
  buildClassifierInput,
  buildLearningReply,
  buildScannerReply,
  canTeach,
  REPLY_NOTE_MARKER,
  decideLearningDetailed,
  normalizePathGlob,
  screenReplyDetailed,
} from '@/ee/security/security-scan/thread-reply'
import { classifyWithRetry } from '@/ee/security/security-scan/thread-reply-retry'
import { wantsThreadAnswer } from '@/ee/security/security-scan/pr-chat'
import { prCommandHandle } from '@/ee/security/services/pr-command-parse'
import { answerQuestion } from '@/ee/security/services/pr-chat.service'
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
  | 'answered'
  | 'closed_scanner'
  | 'learning_added'
  | 'closed_no_learning'
  | 'failed'

/**
 * A reply that did not become a learning, logged at warn with the stage and
 * the reason — never the reply text, only its length and a short hash, so a
 * wrongly rejected reply can be matched to its GitHub comment and traced to
 * the rule (or model answer) that rejected it.
 */
function logNoLearning(
  event: ThreadReplyEvent,
  stage: 'gate' | 'model',
  label: string,
  reason: string
): void {
  const body = event.comment.body
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 12)
  logger.warn(
    `[pr-thread-reply] no learning pr=${event.pullRequestId} comment=${event.comment.id} stage=${stage} label=${label} reason=${reason} len=${body.length} sha=${hash}`
  )
}

/**
 * The model's answer, or null when it could not be had (never thrown). A
 * refusal or a failed call (timeout included) is asked once more, within a
 * bounded total time (`classifyWithRetry`, LUM-1139) — still inside this one
 * claimed reply, so a retry never posts a second answer or stores a second
 * learning.
 */
async function askModel(
  finding: { ruleId: string; title: string; filePath: string },
  body: string
): Promise<ThreadReplyVerdict | null> {
  try {
    const { classifyThreadReply } =
      await import('@/ee/security/llm/thread-reply-client')
    const input = buildClassifierInput(finding, body)
    const result = await classifyWithRetry((timeoutMs, attempt) =>
      classifyThreadReply({
        ...input,
        timeoutMs,
        tier: attempt === 1 ? 'primary' : 'fallback',
      })
    )
    if (result.retried)
      logger.info(
        `[pr-thread-reply] classifier retried reason=${result.retried} attempts=${result.attempts} learning=${result.verdict?.isLearning ?? 'none'}`
      )
    if (!result.verdict)
      logger.warn(
        `[pr-thread-reply] classifier unavailable after ${result.attempts} attempt(s): ${result.errors.join(' | ')}`
      )
    return result.verdict
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

/**
 * LUM-1127 (PR 1454): GitHub refuses thread resolution to a pull-request-only
 * token, so the close mints `reviewThreadWrite`; a refused mint falls back
 * to the reply token (the resolve then fails and the reply says so).
 */
async function threadToken(
  workspaceId: string,
  gh: GithubCtx
): Promise<string> {
  try {
    return await getRepoToken(
      workspaceId,
      `${gh.repo.owner}/${gh.repo.name}`,
      REPO_TOKEN_PERMISSIONS.reviewThreadWrite
    )
  } catch (error) {
    logger.warn(
      `[pr-thread-reply] thread token mint failed: ${error instanceof Error ? error.message : String(error)}`
    )
    return gh.token
  }
}

/**
 * Resolve the thread on GitHub and record it as closed by the human. true
 * only when GitHub says the thread is resolved (by this call or already) —
 * the reply never claims a close that did not happen, and the row is not
 * marked closed while GitHub still shows it open. Never throws.
 */
async function closeThread(
  workspaceId: string,
  gh: GithubCtx,
  row: FindingThreadRow,
  login: string
): Promise<boolean> {
  try {
    const token = await threadToken(workspaceId, gh)
    let threadId = row.threadNodeId
    let resolved = false
    if (!threadId) {
      const threads = await reviewThreadClient.listReviewThreads({
        ...gh,
        token,
      })
      const t = threads.find(x => String(x.firstCommentId) === row.commentId)
      threadId = t?.id ?? null
      resolved = t?.isResolved ?? false
    }
    if (!threadId) return false
    if (!resolved) await reviewThreadClient.resolveThread({ threadId, token })
    await prFindingThreadRepository.update(row.id, {
      state: 'RESOLVED_BY_USER',
      resolvedByLogin: login,
      resolvedAt: new Date(),
      threadNodeId: threadId,
    })
    return true
  } catch (error) {
    logger.warn(
      `[pr-thread-reply] close failed fp=${row.fingerprint}: ${error instanceof Error ? error.message : String(error)}`
    )
    return false
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

/** Store the learning: the memory and its repository scope, in one transaction. */
async function storeLearning(input: {
  event: ThreadReplyEvent
  row: FindingThreadRow
  login: string
  memberId: string | null
  learning: string
  pathGlob: string | null
}): Promise<'stored' | 'no_project' | 'failed'> {
  const { event, row, login, learning, pathGlob } = input
  const replyId = String(event.comment.id)
  const projectId = await projectIdFor(event)
  if (!projectId) return 'no_project'
  const scope = `Lumo AI review of ${event.repo}${pathGlob ? `, files matching ${pathGlob}` : ''} — from @${login}'s reply on ${event.repo}#${event.prNumber} (finding ${row.ruleId})`
  try {
    await memoryManagementService.createReviewLearning(
      {
        projectId,
        workspaceId: event.workspaceId,
        content: {
          summary: `PR review learning: ${learning.length > 90 ? `${learning.slice(0, 89).trimEnd()}…` : learning}`,
          rule: learning,
          scope,
        },
        actorMemberId: input.memberId,
      },
      // Same transaction as the memory: no orphan memory if this fails.
      async (memoryId, tx) => {
        await prReviewLearningRepository.create(
          {
            workspaceId: event.workspaceId,
            memoryId,
            repo: event.repo,
            pathGlob,
            ruleId: row.ruleId,
            fingerprint: row.fingerprint,
            sourcePullRequestId: event.pullRequestId,
            sourceReplyId: replyId,
            authorLogin: login,
          },
          tx
        )
      }
    )
    return 'stored'
  } catch (error) {
    logger.warn(
      `[pr-thread-reply] learning not stored pr=${event.pullRequestId}: ${error instanceof Error ? error.message : String(error)}`
    )
    return 'failed'
  }
}

/** Give the reply back after a failure, so a redelivery is answered. Never throws. */
async function releaseClaim(
  row: FindingThreadRow,
  replyId: string
): Promise<void> {
  try {
    await prFindingThreadRepository.releaseReply(row.id, replyId)
  } catch (error) {
    logger.warn(
      `[pr-thread-reply] claim release failed fp=${row.fingerprint}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * LUM-1154 — answer a question asked in a Lumo finding thread. `null` when
 * the chat did not take it (no write access, an injection signal, nothing
 * asked): the caller then posts the usual acknowledgement. Throws when the
 * answer could not be posted, like the other replies here.
 */
async function answerInThread(
  event: ThreadReplyEvent,
  gh: GithubCtx,
  row: FindingThreadRow,
  login: string
): Promise<ThreadReplyOutcome | null> {
  const finding = await latestFinding(event.pullRequestId, row.fingerprint)
  const blockingId = await blockingFindingId(event.workspaceId, finding)
  const outcome = await answerQuestion({
    workspaceId: event.workspaceId,
    pullRequestId: event.pullRequestId,
    repo: event.repo,
    prNumber: event.prNumber,
    source: 'review',
    commentId: event.comment.id,
    login,
    body: event.comment.body,
    focus: {
      path: row.filePath,
      line: finding?.line ?? null,
      diffHunk: null,
    },
    finding,
    blockingFindingId: blockingId,
    marker: REPLY_NOTE_MARKER,
    post: body => postReply(gh, row, body),
  })
  switch (outcome) {
    case 'empty':
    case 'ignored_injection':
    case 'unauthorized':
      return null
    case 'duplicate':
      return 'duplicate'
    case 'failed':
      throw new Error('chat answer failed')
    default:
      return 'answered'
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
    await releaseClaim(row, String(comment.id))
    return 'failed'
  }
  const [owner = '', name = ''] = event.repo.split('/')
  const gh: GithubCtx = {
    repo: { owner, name },
    prNumber: event.prNumber,
    token,
  }

  try {
    const screened = screenReplyDetailed(comment.body)
    const label = screened.label
    if (label !== 'LEARNING') {
      logNoLearning(event, 'gate', label, screened.reason)
      // LUM-1154: a question gets a grounded answer instead of the template.
      // The learning gate ran first and keeps its precedence.
      if (wantsThreadAnswer(comment.body, label, prCommandHandle())) {
        const answered = await answerInThread(event, gh, row, login)
        if (answered !== null) return answered
      }
      await postReply(gh, row, buildAckReply(label, login))
      return 'acknowledged'
    }

    const finding = await latestFinding(event.pullRequestId, row.fingerprint)
    const blockingId = await blockingFindingId(event.workspaceId, finding)

    // Learnings shape the AI review only: a scanner / hunt finding gets the
    // thread closed and the way to rule it out.
    if (layerOf(row) !== 'judge') {
      const closed = await closeThread(event.workspaceId, gh, row, login)
      await postReply(
        gh,
        row,
        buildScannerReply({ login, closed, blockingFindingId: blockingId })
      )
      return 'closed_scanner'
    }

    // Order: store → close → answer. If the answer then fails, the claim is
    // released and a redelivery lands here again: the stored learning is
    // reused (no second model call, no second memory) and the close is a
    // no-op on a resolved thread — so a retry repeats only the answer.
    const replyId = String(comment.id)
    const prior = await prReviewLearningRepository.findBySourceReply(
      event.workspaceId,
      replyId
    )
    let learning: string | null
    let pathGlob: string | null
    let stored: 'stored' | 'no_project' | 'failed'
    if (prior) {
      const parsed = conventionContentSchema.safeParse(prior.content)
      learning = parsed.success ? parsed.data.rule : null
      pathGlob = prior.pathGlob
      stored = 'stored'
    } else {
      const verdict = await askModel(
        {
          ruleId: row.ruleId,
          title: finding?.title ?? row.ruleId,
          filePath: row.filePath,
        },
        comment.body
      )
      const decided = decideLearningDetailed(label, verdict)
      learning = decided.learning
      if (!learning) logNoLearning(event, 'model', label, decided.reason)
      pathGlob = learning
        ? normalizePathGlob(verdict?.pathGlob, row.filePath)
        : null
      stored = learning
        ? await storeLearning({
            event,
            row,
            login,
            memberId,
            learning,
            pathGlob,
          })
        : 'failed'
    }
    if (!learning) {
      await postReply(gh, row, buildAckReply('OTHER', login))
      return 'acknowledged'
    }
    const closed = await closeThread(event.workspaceId, gh, row, login)
    await postReply(
      gh,
      row,
      buildLearningReply({
        login,
        learning,
        repo: event.repo,
        pathGlob,
        stored,
        closed,
        blockingFindingId: blockingId,
      })
    )
    return stored === 'stored' ? 'learning_added' : 'closed_no_learning'
  } catch (error) {
    logger.warn(
      `[pr-thread-reply] reply failed pr=${event.pullRequestId} comment=${comment.id}: ${error instanceof Error ? error.message : String(error)}`
    )
    // Not answered: a redelivery may try again. Safe to repeat — a stored
    // learning is found by its reply id, a resolved thread stays resolved.
    await releaseClaim(row, String(comment.id))
    return 'failed'
  }
}
