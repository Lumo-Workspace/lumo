/**
 * LUM-1154 — Lumo answers questions on a pull request: a reply in one of its
 * finding threads (called from the LUM-1131 thread-reply service once the
 * learning gate has passed on it), an @-mention on a code line, or an
 * @-mention in the PR conversation that is not a LUM-1129 command.
 *
 *   · only a human with write access to the repository is answered — anyone
 *     else (a drive-by account on a public repository) is ignored silently,
 *     so they can neither make Lumo talk nor spend its model budget;
 *   · a question carrying a prompt-injection signal gets no model call and no
 *     answer; one that asks Lumo to act (approve, dismiss, …) gets a fixed
 *     refusal, never a model call;
 *   · one answer per comment (a `PrChatRequest` row is the claim) and at most
 *     `PR_CHAT_MAX_PER_HOUR` answers per PR per hour;
 *   · the answer is words only: no thread is resolved, no finding
 *     dispositioned, nothing approved. In a thread on a finding that blocks
 *     DONE, the answer says it still blocks.
 *
 * Best effort: GitHub / model / storage failures are logged, never thrown.
 *
 * Layering: service — GitHub through `@/lib/integrations/github/*`, the
 * database through repositories, the model through a dynamically imported
 * client.
 */
import { createHash } from 'node:crypto'
import { logger } from '@/lib/logger'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'
import { checkRepositoryWriteAccess } from '@/lib/integrations/github/collaborator-access'
import { prCommentClient } from '@/lib/integrations/github/pr-comment-client'
import {
  fetchPrDiff,
  fetchPrHeadSha,
  readRepoFile,
} from '@/lib/integrations/github/contents'
import type { CoreEvents } from '@/lib/plugins/types'
import {
  guardInjectedText,
  guardPromptLineText,
} from '@/lib/security-scan/inject-guard'
import {
  prChatRequestRepository,
  type PrChatSource,
} from '@/ee/security/repositories/pr-chat-request.repository'
import type { FindingRow } from '@/ee/security/repositories/pr-security-scan.repository'
import { isLumoActor } from '@/ee/security/services/pr-finding-thread.service'
import { prCommandHandle } from '@/ee/security/services/pr-command-parse'
import {
  CHAT_ANSWER_MARKER,
  PR_CHAT_MAX_PER_HOUR,
  PR_CHAT_WINDOW_MS,
  asksToAct,
  buildActionRefusalReply,
  buildChatAnswerBody,
  buildRateLimitedReply,
  buildUnavailableReply,
  cleanChatAnswer,
  hasInjectionSignal,
  mentionsHandle,
  packDiff,
  questionText,
  windowLines,
} from '@/ee/security/security-scan/pr-chat'

export type ChatOutcome =
  | 'answered'
  | 'empty'
  | 'ignored_injection'
  | 'unauthorized'
  | 'duplicate'
  | 'refused_action'
  | 'rate_limited'
  | 'unavailable'
  | 'failed'

export interface ChatQuestion {
  workspaceId: string
  pullRequestId: string
  repo: string
  prNumber: number
  source: PrChatSource
  commentId: number
  login: string
  /** The comment, raw and untrusted. */
  body: string
  /** The file / line the question is about (a thread or a line comment). */
  focus: { path: string; line: number | null; diffHunk: string | null } | null
  /** In a finding thread: the finding on the PR's latest scan, if still there. */
  finding: FindingRow | null
  /** In a finding thread: the finding blocks DONE — the answer says so. */
  blockingFindingId: string | null
  /** Hidden marker the posted comment carries. */
  marker: string
  /** Posts Lumo's comment where the question was asked. */
  post: (body: string, token: string) => Promise<void>
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A short hash of the question for logs — never the text itself. */
function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

async function hasWriteAccess(q: ChatQuestion): Promise<boolean> {
  try {
    const token = await getRepoToken(
      q.workspaceId,
      q.repo,
      REPO_TOKEN_PERMISSIONS.collaboratorPermission
    )
    return (
      (await checkRepositoryWriteAccess(token, q.repo, q.login)) === 'write'
    )
  } catch (error) {
    logger.warn(
      `[pr-chat] write-access check failed pr=${q.repo}#${q.prNumber}: ${describe(error)}`
    )
    return false
  }
}

/** The diff, head and asked-about file. Each part fails soft to empty. */
async function loadContext(q: ChatQuestion): Promise<{
  headSha: string | null
  diff: string
  file: string
}> {
  const ref = {
    workspaceId: q.workspaceId,
    fullName: q.repo,
    prNumber: q.prNumber,
  }
  const [headSha, diff] = await Promise.all([
    fetchPrHeadSha(ref).catch((error: unknown) => {
      logger.warn(
        `[pr-chat] head unreadable pr=${q.repo}#${q.prNumber}: ${describe(error)}`
      )
      return null
    }),
    fetchPrDiff(ref).catch((error: unknown) => {
      logger.warn(
        `[pr-chat] diff unreadable pr=${q.repo}#${q.prNumber}: ${describe(error)}`
      )
      return ''
    }),
  ])
  let file = ''
  if (q.focus) {
    try {
      file =
        (await readRepoFile({
          workspaceId: q.workspaceId,
          fullName: q.repo,
          path: q.focus.path,
          ...(headSha ? { ref: headSha } : {}),
        })) ?? ''
    } catch (error) {
      logger.warn(
        `[pr-chat] file unreadable pr=${q.repo}#${q.prNumber}: ${describe(error)}`
      )
    }
  }
  return { headSha, diff, file }
}

/** The model's answer, or null (never thrown). */
async function askModel(
  q: ChatQuestion,
  question: string
): Promise<string | null> {
  try {
    const ctx = await loadContext(q)
    const focusLine = q.focus?.line ?? q.finding?.line ?? null
    const packed = packDiff(ctx.diff, q.focus?.path ?? null)
    const diff = guardInjectedText(packed.text)
    const file = guardInjectedText(
      ctx.file ? windowLines(ctx.file, focusLine) : ''
    )
    const guardedQuestion = guardInjectedText(question)
    const { answerPrQuestion } =
      await import('@/ee/security/llm/pr-chat-client')
    const raw = await answerPrQuestion({
      repo: q.repo,
      prNumber: q.prNumber,
      headSha: ctx.headSha,
      finding: q.finding
        ? {
            title: guardPromptLineText(q.finding.title),
            ruleId: guardPromptLineText(q.finding.ruleId),
            severity: q.finding.severity,
            filePath: guardPromptLineText(q.finding.filePath),
            line: q.finding.line,
            detail: guardPromptLineText(q.finding.detail.slice(0, 1_500)),
          }
        : null,
      focus: q.focus
        ? { path: guardPromptLineText(q.focus.path), line: focusLine }
        : null,
      question: {
        text: guardedQuestion.text,
        notices: guardedQuestion.notices,
      },
      diff: {
        text: diff.text,
        notices: diff.notices,
        truncated: packed.truncated,
      },
      file: { text: file.text, notices: file.notices },
      hunk: q.focus?.diffHunk
        ? (() => {
            const h = guardInjectedText(q.focus.diffHunk.slice(0, 4_000))
            return { text: h.text, notices: h.notices }
          })()
        : null,
    })
    return cleanChatAnswer(raw)
  } catch (error) {
    logger.warn(
      `[pr-chat] model unavailable pr=${q.repo}#${q.prNumber}: ${describe(error)}`
    )
    return null
  }
}

/**
 * Answer one question. Silent outcomes (empty, injection, no write access, a
 * duplicate, a second rate-limit hit in the window) post nothing; every
 * other outcome posts exactly one comment. Never throws.
 */
export async function answerQuestion(q: ChatQuestion): Promise<ChatOutcome> {
  const where = `pr=${q.repo}#${q.prNumber} ${q.source}=${q.commentId}`
  const handle = prCommandHandle()
  const question = questionText(q.body, handle)
  if (!question) return 'empty'
  if (hasInjectionSignal(q.body)) {
    logger.warn(
      `[pr-chat] not answered ${where}: injection signal len=${q.body.length} sha=${sha(q.body)}`
    )
    return 'ignored_injection'
  }
  if (!(await hasWriteAccess(q))) {
    logger.info(`[pr-chat] ignored ${where}: ${q.login} has no write access`)
    return 'unauthorized'
  }

  let claim: { id: string } | null
  try {
    claim = await prChatRequestRepository.claim({
      workspaceId: q.workspaceId,
      pullRequestId: q.pullRequestId,
      source: q.source,
      commentId: String(q.commentId),
      authorLogin: q.login,
    })
  } catch (error) {
    logger.warn(`[pr-chat] claim failed ${where}: ${describe(error)}`)
    return 'failed'
  }
  if (!claim) return 'duplicate'
  const claimId = claim.id
  let posted = false
  const post = async (body: string, token: string): Promise<void> => {
    await q.post(body, token)
    posted = true
  }

  try {
    const token = await getRepoToken(
      q.workspaceId,
      q.repo,
      REPO_TOKEN_PERMISSIONS.pullRequestWrite
    )

    const since = new Date(Date.now() - PR_CHAT_WINDOW_MS)
    const answering = await prChatRequestRepository.countSince(
      q.pullRequestId,
      since,
      ['CLAIMED', 'ANSWERED']
    )
    if (answering > PR_CHAT_MAX_PER_HOUR) {
      // One note per window: later questions in it are not answered at all.
      const noted = await prChatRequestRepository.countSince(
        q.pullRequestId,
        since,
        ['RATE_LIMITED']
      )
      await prChatRequestRepository.setStatus(claimId, 'RATE_LIMITED')
      if (noted === 0)
        await post(buildRateLimitedReply(q.login, q.marker), token)
      logger.info(`[pr-chat] rate limited ${where}`)
      return 'rate_limited'
    }

    if (asksToAct(question)) {
      await post(buildActionRefusalReply(q.login, handle, q.marker), token)
      await prChatRequestRepository.setStatus(claimId, 'ANSWERED')
      return 'refused_action'
    }

    const answer = await askModel(q, question)
    if (!answer) {
      await post(buildUnavailableReply(q.login, q.marker), token)
      await prChatRequestRepository.setStatus(claimId, 'FAILED')
      return 'unavailable'
    }
    await post(
      buildChatAnswerBody({
        login: q.login,
        answer,
        marker: q.marker,
        blockingFindingId: q.blockingFindingId,
      }),
      token
    )
    await prChatRequestRepository.setStatus(claimId, 'ANSWERED')
    logger.info(`[pr-chat] answered ${where} by ${q.login}`)
    return 'answered'
  } catch (error) {
    logger.warn(`[pr-chat] failed ${where}: ${describe(error)}`)
    // Not answered: a redelivery may try again. Once something was posted the
    // claim stays, so a redelivery never posts a second answer.
    if (!posted)
      await prChatRequestRepository.release(claimId).catch(() => undefined)
    return 'failed'
  }
}

function parseRepo(full: string): { owner: string; name: string } {
  const [owner = '', name = ''] = full.split('/')
  return { owner, name }
}

function isHuman(user: { login?: string; type?: string } | null): user is {
  login: string
  type?: string
} {
  if (!user?.login) return false
  if (user.type !== 'User') return false
  if (/\[bot\]$/i.test(user.login)) return false
  return !isLumoActor(user)
}

/**
 * An @-mention of Lumo in a review-line comment — a new comment on the diff,
 * or a reply in a thread that is not one of Lumo's finding threads (those go
 * through the thread-reply service). Answered in the same thread.
 */
export async function applyLineMention(
  event: CoreEvents['github.reviewComment']
): Promise<ChatOutcome | 'ignored'> {
  if (event.action !== 'created') return 'ignored'
  const handle = prCommandHandle()
  const user = event.comment.user
  if (!handle || !isHuman(user)) return 'ignored'
  if (!mentionsHandle(event.comment.body, handle)) return 'ignored'
  const repo = parseRepo(event.repo)
  const threadRoot = event.comment.inReplyToId ?? event.comment.id
  return answerQuestion({
    workspaceId: event.workspaceId,
    pullRequestId: event.pullRequestId,
    repo: event.repo,
    prNumber: event.prNumber,
    source: 'review',
    commentId: event.comment.id,
    login: user.login,
    body: event.comment.body,
    focus: event.comment.path
      ? {
          path: event.comment.path,
          line: event.comment.line ?? null,
          diffHunk: event.comment.diffHunk ?? null,
        }
      : null,
    finding: null,
    blockingFindingId: null,
    marker: CHAT_ANSWER_MARKER,
    post: async (body, token) => {
      await prCommentClient.createReviewLineReply({
        repo,
        prNumber: event.prNumber,
        inReplyTo: threadRoot,
        body,
        token,
      })
    },
  })
}

/**
 * An @-mention of Lumo in the PR conversation that is not a command
 * (`routeConversationComment` decided). Answered with a conversation comment.
 */
export async function applyConversationQuestion(
  event: CoreEvents['github.issueComment']
): Promise<ChatOutcome | 'ignored'> {
  if (event.action !== 'created') return 'ignored'
  const handle = prCommandHandle()
  const user = event.comment.user
  if (!handle || !isHuman(user)) return 'ignored'
  if (!mentionsHandle(event.comment.body, handle)) return 'ignored'
  const repo = parseRepo(event.repo)
  return answerQuestion({
    workspaceId: event.workspaceId,
    pullRequestId: event.pullRequestId,
    repo: event.repo,
    prNumber: event.prNumber,
    source: 'issue',
    commentId: event.comment.id,
    login: user.login,
    body: event.comment.body,
    focus: null,
    finding: null,
    blockingFindingId: null,
    marker: CHAT_ANSWER_MARKER,
    post: async (body, token) => {
      await prCommentClient.createIssueComment({
        repo,
        prNumber: event.prNumber,
        body,
        token,
      })
    },
  })
}
