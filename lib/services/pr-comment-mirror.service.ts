import { logger } from '@/lib/logger'
import { githubRepository } from '@/lib/repositories/github.repository'
import { getRepoToken } from '@/lib/integrations/github/auth'
import { REPO_TOKEN_PERMISSIONS } from '@/lib/integrations/github/token-permissions'
import { waitUntil } from '@vercel/functions'
import type { OutboundActorKind, PrCommentSource } from '@prisma/client'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  lumoHtmlToGithubMarkdown,
  githubMarkdownToLumoHtml,
  buildHeader,
  computeBodyHash,
  escapeHtml,
  REVIEW_HEADER,
} from '@/lib/integrations/github/markdown-bridge'
import { sanitizeCommentHtml } from '@/lib/html/sanitize-comment-html'
import {
  prCommentClient,
  GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'
import { githubActorService } from '@/lib/services/github-actor.service'
import { taskRepository } from '@/lib/repositories/task.repository'
import { buildTaskUrl } from '@/lib/utils/buildTaskUrl'
import { scrubCommentsIfRepositoryUnconfirmed } from '@/lib/services/pr-comment-code-scrub.service'

interface Repo {
  owner: string
  name: string
}

/**
 * A mirror written before LUM-741's consolidation, whose GitHub comment was
 * posted by a person's OAuth token.
 *
 * GitHub does not let one identity edit or delete another's comment, so the App
 * simply cannot touch these — attempting it returns 403 and the catch below
 * would re-enqueue the job forever. Skip instead: the Lumo-side edit or delete
 * still happens, and the stale GitHub comment keeps its link back to Lumo.
 */
function isLegacyUserAuthored(mirror: {
  id: string
  outboundActor: OutboundActorKind
}): boolean {
  if (mirror.outboundActor !== 'USER_OAUTH') return false
  logger.info(
    `[pr-comment-mirror] skipping outbound sync for legacy user-authored mirror ${mirror.id} — the Lumo App cannot edit or delete a comment posted by a person`
  )
  return true
}

function parseRepo(repo: string): Repo {
  const parts = repo.split('/')
  const owner = parts[0] ?? ''
  const name = parts[1] ?? ''
  return { owner, name }
}

/**
 * Resolve actor id → display name for the bot-prefix template.
 * Strategy:
 *   1. memberRepository.findByActorId(actorId) gives us { id, workspaceId }
 *   2. Lookup WorkspaceMember row directly to get clerkId
 *   3. Fetch Clerk user → firstName + lastName or email-localpart
 *   4. Any failure → 'Someone' (degraded but safe)
 */
async function resolveAuthorDisplayName(actorId: string): Promise<string> {
  try {
    const member = await memberRepository.findByActorId(actorId)
    if (!member) return 'Someone'
    const clerkId = await memberRepository.findClerkIdById(member.id)
    if (!clerkId) return 'Someone'
    const { clerkClient } = await import('@clerk/nextjs/server')
    const client = await clerkClient()
    const user = await client.users.getUser(clerkId)
    const fullName = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim()
    if (fullName) return fullName
    const email = user.emailAddresses[0]?.emailAddress
    const localPart = email ? email.split('@')[0] : undefined
    return localPart ?? 'Someone'
  } catch {
    return 'Someone'
  }
}

/**
 * Every outbound comment is posted by the Lumo App, so the body always carries
 * the author attribution prefix — the App cannot speak as a person, and the
 * link back to the Lumo comment is what preserves "who said this".
 */
async function buildOutboundBody(
  comment: { body: string; authorActorId: string | null },
  commentUrl: string
): Promise<{ body: string; bodyHash: string }> {
  const rendered = lumoHtmlToGithubMarkdown(comment.body, _clerkId => {
    // resolver: clerkId → github login (best-effort; null for unknowns)
    return null
  })

  const authorName = comment.authorActorId
    ? await resolveAuthorDisplayName(comment.authorActorId)
    : 'Someone'
  const prefixed = `**[${authorName}](${commentUrl}) 在 Lumo 说：**\n\n${rendered}`
  return { body: prefixed, bodyHash: computeBodyHash(prefixed) }
}

/**
 * LUM-925: a PR linked to tasks in more than one workspace was linked by branch
 * name alone, and at most one of those tasks is really its own. Posting or
 * editing would publish one workspace's internal discussion on a PR that
 * belongs to another, so outbound create/update stop here. Delete still runs:
 * removing a comment that already leaked only reduces exposure.
 */
async function isLinkedInSeveralWorkspaces(pr: {
  id: string
  repo: string
  number: number
}): Promise<boolean> {
  const linked = await pullRequestRepository.countTaskLinkedWorkspaces(
    pr.repo,
    pr.number
  )
  if (linked > 1) {
    logger.warn(
      `[pr-comment-mirror] skipping outbound sync for PR ${pr.id} (${pr.repo}#${pr.number}) — it is linked to tasks in ${linked} workspaces`
    )
    return true
  }
  return false
}

async function runOutboundCreate(commentId: string) {
  const comment = await commentRepository.findById(commentId)
  if (!comment) return
  if (!comment.taskId) return // idea comment (LUM-680) — no PR to mirror to
  if (comment.type === 'AGENT') return

  const pr = await pullRequestRepository.findByTaskId(comment.taskId)
  if (!pr) return
  if (await isLinkedInSeveralWorkspaces(pr)) return

  const repo = parseRepo(pr.repo)

  // --- Retry idempotency: check for an existing mirror before calling reserve() ---
  const existingMirror =
    await prCommentMirrorRepository.findByCommentId(commentId)
  if (existingMirror) {
    if (!existingMirror.externalId.startsWith('pending-')) {
      // Already fully resolved — nothing to do.
      return
    }
    // Previous attempt inserted a placeholder but failed before GitHub responded.
    // Check whether the POST actually went through (list-and-match).
    const appToken = await getRepoToken(
      pr.workspaceId,
      pr.repo,
      REPO_TOKEN_PERMISSIONS.pullRequestWrite
    )
    const since = new Date(existingMirror.lastSyncedAt.getTime() - 5 * 60_000)
    // Branch on the original mirror's source so we hit the right GH endpoint —
    // listIssueCommentsSince does NOT include review-line comments and vice versa.
    const recent =
      existingMirror.externalSource === 'REVIEW_LINE'
        ? await prCommentClient.listReviewCommentsSince({
            repo,
            prNumber: pr.number,
            since,
            token: appToken,
          })
        : await prCommentClient.listIssueCommentsSince({
            repo,
            prNumber: pr.number,
            since,
            token: appToken,
          })
    const { bodyHash: pendingHash } = await buildOutboundBody(comment, '')
    const matched = recent.find(c => computeBodyHash(c.body) === pendingHash)
    if (matched) {
      // The POST already went through — resolve the placeholder with the GH-provided
      // fields (id / node_id / html_url / updated_at) rather than synthesized blanks.
      await prCommentMirrorRepository.resolvePlaceholder(existingMirror.id, {
        externalId: String(matched.id),
        externalNodeId: matched.node_id,
        externalUrl: matched.html_url,
        externalUpdatedAt: new Date(matched.updated_at),
      })
      return
    }
    // Safe to re-POST. Build body with real commentUrl.
    // Re-use existingMirror — do NOT call reserve() again.
    const retryTask = await taskRepository.findForComment(comment.taskId)
    const retryCommentUrl = retryTask
      ? `${buildTaskUrl(retryTask.project.workspace.slug, retryTask.project.name, retryTask.team.identifier, retryTask.number)}#comment-${commentId}`
      : ''
    const { body: retryBody } = await buildOutboundBody(
      comment,
      retryCommentUrl
    )
    const retryToken = appToken
    try {
      const isReviewLineReplyRetry =
        existingMirror.externalSource === 'REVIEW_LINE' &&
        existingMirror.inReplyToExternalId != null
      const retryResponse = isReviewLineReplyRetry
        ? await prCommentClient.createReviewLineReply({
            repo,
            prNumber: pr.number,
            inReplyTo: Number(existingMirror.inReplyToExternalId),
            body: retryBody,
            token: retryToken,
          })
        : await prCommentClient.createIssueComment({
            repo,
            prNumber: pr.number,
            body: retryBody,
            token: retryToken,
          })
      await prCommentMirrorRepository.resolvePlaceholder(existingMirror.id, {
        externalId: String(retryResponse.id),
        externalNodeId: retryResponse.node_id,
        externalUrl: retryResponse.html_url,
        externalUpdatedAt: new Date(retryResponse.updated_at),
      })
    } catch (err) {
      const resetAt =
        err instanceof GithubApiError ? err.rateLimitResetAt : undefined
      await prCommentSyncJobRepository.enqueue({
        direction: 'OUTBOUND',
        payload: { op: 'CREATE', mirrorId: existingMirror.id },
        commentId,
        workspaceId: pr.workspaceId,
        ...(resetAt ? { scheduledFor: resetAt } : {}),
      })
      throw err
    }
    return
  }

  // Determine if this is a review-line reply
  let parentMirror: { externalSource: string; externalId: string } | null = null
  if (comment.parentId) {
    parentMirror = await prCommentMirrorRepository.findByCommentId(
      comment.parentId
    )
  }
  const isReviewLineReply = parentMirror?.externalSource === 'REVIEW_LINE'

  // One outbound identity: the workspace's App installation.
  const createToken = await getRepoToken(
    pr.workspaceId,
    pr.repo,
    REPO_TOKEN_PERMISSIONS.pullRequestWrite
  )

  const task = await taskRepository.findForComment(comment.taskId)
  const commentUrl = task
    ? `${buildTaskUrl(task.project.workspace.slug, task.project.name, task.team.identifier, task.number)}#comment-${commentId}`
    : ''
  const { body, bodyHash } = await buildOutboundBody(comment, commentUrl)

  // Reserve mirror BEFORE the GitHub call
  const mirror = await prCommentMirrorRepository.reserve({
    commentId,
    pullRequestId: pr.id,
    externalSource: isReviewLineReply ? 'REVIEW_LINE' : 'ISSUE',
    outboundActor: 'BOT_APP',
    outboundActorUserId: null,
    bodyHash,
    inReplyToExternalId: isReviewLineReply ? parentMirror!.externalId : null,
  })

  try {
    const response = isReviewLineReply
      ? await prCommentClient.createReviewLineReply({
          repo,
          prNumber: pr.number,
          inReplyTo: Number(parentMirror!.externalId),
          body,
          token: createToken,
        })
      : await prCommentClient.createIssueComment({
          repo,
          prNumber: pr.number,
          body,
          token: createToken,
        })

    await prCommentMirrorRepository.resolvePlaceholder(mirror.id, {
      externalId: String(response.id),
      externalNodeId: response.node_id,
      externalUrl: response.html_url,
      externalUpdatedAt: new Date(response.updated_at),
    })
  } catch (err) {
    const resetAt =
      err instanceof GithubApiError ? err.rateLimitResetAt : undefined
    await prCommentSyncJobRepository.enqueue({
      direction: 'OUTBOUND',
      payload: { op: 'CREATE', mirrorId: mirror.id },
      commentId,
      workspaceId: pr.workspaceId,
      ...(resetAt ? { scheduledFor: resetAt } : {}),
    })
    throw err
  }
}

async function runOutboundUpdate(commentId: string) {
  const comment = await commentRepository.findById(commentId)
  if (!comment) return
  if (!comment.taskId) return // idea comment (LUM-680) — no PR to mirror to
  const mirror = await prCommentMirrorRepository.findByCommentId(commentId)
  if (!mirror) return // never mirrored — nothing to push

  const pr = await pullRequestRepository.findByTaskId(comment.taskId)
  if (!pr) return
  if (await isLinkedInSeveralWorkspaces(pr)) return
  const repo = parseRepo(pr.repo)

  if (isLegacyUserAuthored(mirror)) return
  const token = await getRepoToken(
    pr.workspaceId,
    pr.repo,
    REPO_TOKEN_PERMISSIONS.pullRequestWrite
  )

  const updateTask = await taskRepository.findForComment(comment.taskId)
  const updateCommentUrl = updateTask
    ? `${buildTaskUrl(updateTask.project.workspace.slug, updateTask.project.name, updateTask.team.identifier, updateTask.number)}#comment-${commentId}`
    : ''
  const { body, bodyHash } = await buildOutboundBody(comment, updateCommentUrl)

  try {
    const response =
      mirror.externalSource === 'REVIEW_LINE'
        ? await prCommentClient.updateReviewLineComment({
            repo,
            externalId: mirror.externalId,
            body,
            token,
          })
        : await prCommentClient.updateIssueComment({
            repo,
            externalId: mirror.externalId,
            body,
            token,
          })

    await prCommentMirrorRepository.patchAfterEdit(
      mirror.id,
      new Date(response.updated_at),
      bodyHash
    )
  } catch (err) {
    const resetAt =
      err instanceof GithubApiError ? err.rateLimitResetAt : undefined
    await prCommentSyncJobRepository.enqueue({
      direction: 'OUTBOUND',
      payload: { op: 'UPDATE', mirrorId: mirror.id },
      commentId,
      workspaceId: pr.workspaceId,
      ...(resetAt ? { scheduledFor: resetAt } : {}),
    })
    throw err
  }
}

async function runOutboundDelete(commentId: string) {
  const mirror = await prCommentMirrorRepository.findByCommentId(commentId)
  if (!mirror) return

  const comment = await commentRepository.findById(commentId)
  if (!comment) return
  if (!comment.taskId) return // idea comment (LUM-680) — no PR to mirror to

  const pr = await pullRequestRepository.findByTaskId(comment.taskId)
  if (!pr) return

  const repo = parseRepo(pr.repo)

  if (isLegacyUserAuthored(mirror)) return
  const token = await getRepoToken(
    pr.workspaceId,
    pr.repo,
    REPO_TOKEN_PERMISSIONS.pullRequestWrite
  )

  try {
    if (mirror.externalSource === 'REVIEW_LINE') {
      await prCommentClient.deleteReviewLineComment({
        repo,
        externalId: mirror.externalId,
        token,
      })
    } else {
      await prCommentClient.deleteIssueComment({
        repo,
        externalId: mirror.externalId,
        token,
      })
    }
    // Keep mirror row for echo defense; just tombstone it
    await prCommentMirrorRepository.markDeleted(mirror.id)
  } catch (err) {
    const resetAt =
      err instanceof GithubApiError ? err.rateLimitResetAt : undefined
    await prCommentSyncJobRepository.enqueue({
      direction: 'OUTBOUND',
      payload: { op: 'DELETE', mirrorId: mirror.id },
      commentId,
      workspaceId: pr.workspaceId,
      ...(resetAt ? { scheduledFor: resetAt } : {}),
    })
    throw err
  }
}

const DRAIN_LIMIT = 10
const DEAD_LETTER_THRESHOLD = 3

async function drainAndRetry<T>(
  job: { id: string; attempts: number },
  work: () => Promise<T>
): Promise<void> {
  try {
    await work()
    await prCommentSyncJobRepository.delete(job.id)
  } catch (err) {
    if (err instanceof GithubApiError && err.rateLimitResetAt) {
      await prCommentSyncJobRepository.rescheduleAt(
        job.id,
        err.rateLimitResetAt,
        'rate-limit'
      )
      return
    }
    const message = err instanceof Error ? err.message : String(err)
    const nextAttempts = job.attempts + 1
    if (nextAttempts >= DEAD_LETTER_THRESHOLD) {
      await prCommentSyncJobRepository.markDeadLetter(job.id, message)
      console.error('pr-mirror dead-letter', {
        jobId: job.id,
        attempts: nextAttempts,
        error: message,
      })
    } else {
      await prCommentSyncJobRepository.recordFailure(
        job.id,
        job.attempts,
        message
      )
    }
  }
}

async function drainOutboundForTask(taskId: string) {
  const due = await prCommentSyncJobRepository.findDueByTask(taskId, {
    limit: DRAIN_LIMIT,
  })
  for (const job of due) {
    if (!job.commentId) continue
    const op =
      (job.payload as { op?: 'CREATE' | 'UPDATE' | 'DELETE' }).op ?? 'CREATE'
    const cId = job.commentId
    // Call the private helpers directly to avoid re-triggering the drain loop.
    await drainAndRetry(job, () => {
      if (op === 'CREATE') return runOutboundCreate(cId)
      if (op === 'UPDATE') return runOutboundUpdate(cId)
      return runOutboundDelete(cId)
    })
  }
}

async function drainInboundForPr(pullRequestId: string) {
  const due = await prCommentSyncJobRepository.findDueByPullRequest(
    pullRequestId,
    { limit: DRAIN_LIMIT }
  )
  for (const job of due) {
    const p = job.payload as unknown as InboundPayload
    // Call runInboundCore (the logic body of runInbound) directly to avoid
    // re-triggering the drain loop.
    await drainAndRetry(job, () => runInboundCore(p))
  }
}

const BOT_LOGIN = process.env.LUMO_GITHUB_BOT_LOGIN ?? 'lumo-app[bot]'

interface InboundPayload {
  event: 'issue_comment' | 'pull_request_review' | 'pull_request_review_comment'
  action: 'created' | 'edited' | 'deleted' | 'submitted' | 'dismissed'
  workspaceId: string
  taskId: string
  pullRequestId: string

  raw: any
}

interface InboundCommentNode {
  id: number
  node_id: string
  html_url: string
  body: string | null
  updated_at: string
  user: { id: number; login: string; type: string; avatar_url: string }
  /** GitHub's standing of the author on the repo (OWNER, MEMBER, NONE, …). */
  author_association?: string
  in_reply_to_id?: number
  path?: string
  line?: number
  start_line?: number | null
  side?: 'LEFT' | 'RIGHT'
}

function extractCommentNode(payload: InboundPayload): InboundCommentNode {
  if (payload.event === 'pull_request_review') {
    return payload.raw.review as InboundCommentNode
  }
  return payload.raw.comment as InboundCommentNode
}

/**
 * LUM-1003: the comment author's `author_association`, upper-cased, or null
 * when the payload lacks a well-formed one. Stored raw; `classifyReviewer`
 * decides what it means.
 */
export function authorAssociationOf(node: {
  author_association?: unknown
}): string | null {
  const v = node.author_association
  if (typeof v !== 'string') return null
  const up = v.trim().toUpperCase()
  return /^[A-Z_]{1,40}$/.test(up) ? up : null
}

function payloadSource(payload: InboundPayload): PrCommentSource {
  if (payload.event === 'issue_comment') return 'ISSUE'
  if (payload.event === 'pull_request_review') return 'REVIEW'
  return 'REVIEW_LINE'
}

function isHttpsUrl(url: string | undefined): url is string {
  if (!url) return false
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/** Inbound body, escaped at the source and sanitized like every comment write. */
function buildInboundBody(
  payload: InboundPayload,
  node: InboundCommentNode,
  source: PrCommentSource
): string {
  return sanitizeCommentHtml(buildInboundHtml(payload, node, source))
}

function buildInboundHtml(
  payload: InboundPayload,
  node: InboundCommentNode,
  source: PrCommentSource
): string {
  const md = node.body ?? ''
  const innerHtml = githubMarkdownToLumoHtml(md, () => null) // mention resolver wired later

  if (source === 'REVIEW_LINE' && node.path && node.line) {
    // LUM-921: path and URL come from the webhook payload — escape both and
    // link only a real https URL.
    const label = escapeHtml(`${node.path}:${node.line}`)
    const target = isHttpsUrl(node.html_url)
      ? `<a href="${escapeHtml(node.html_url)}">${label}</a>`
      : label
    const headerInner = `📍 在 ${target} 评论`
    return buildHeader(headerInner) + innerHtml
  }

  if (source === 'REVIEW') {
    const state = (
      payload.raw.review?.state as string | undefined
    )?.toLowerCase()
    let header: string = REVIEW_HEADER.COMMENTED
    if (state === 'approved') header = REVIEW_HEADER.APPROVED
    else if (state === 'changes_requested')
      header = REVIEW_HEADER.CHANGES_REQUESTED
    else if (state === 'dismissed') header = REVIEW_HEADER.DISMISSED
    return buildHeader(header) + innerHtml
  }

  return innerHtml
}

async function resolveInboundParent(
  source: PrCommentSource,
  node: InboundCommentNode
): Promise<{ parentId: string | null; missing: boolean }> {
  if (source !== 'REVIEW_LINE' || !node.in_reply_to_id) {
    return { parentId: null, missing: false }
  }
  const parent = await prCommentMirrorRepository.findByExternal(
    'REVIEW_LINE',
    String(node.in_reply_to_id)
  )
  if (parent?.commentId) return { parentId: parent.commentId, missing: false }
  return { parentId: null, missing: true }
}

async function runInboundCreate(
  payload: InboundPayload,
  node: InboundCommentNode,
  source: PrCommentSource
) {
  const author = await prCommentMirrorService.resolveInboundAuthor(
    payload.workspaceId,
    node.user
  )
  if (!author) return // bot defense triggered

  const body = buildInboundBody(payload, node, source)
  const { parentId, missing } = await resolveInboundParent(source, node)

  const comment = await commentRepository.create({
    taskId: payload.taskId,
    authorActorId: author.actorId,
    body,
    parentId,
    quotedCommentId: null,
  })
  await prCommentMirrorRepository.create({
    commentId: comment.id,
    pullRequestId: payload.pullRequestId,
    externalSource: source,
    externalId: String(node.id),
    externalNodeId: node.node_id,
    externalUrl: node.html_url,
    externalUpdatedAt: new Date(node.updated_at),
    outboundActor: 'BOT_APP',
    outboundActorUserId: null,
    bodyHash: computeBodyHash(node.body ?? ''),
    filePath: source === 'REVIEW_LINE' ? (node.path ?? null) : null,
    lineStart:
      source === 'REVIEW_LINE' ? (node.start_line ?? node.line ?? null) : null,
    lineEnd: source === 'REVIEW_LINE' ? (node.line ?? null) : null,
    diffSide: source === 'REVIEW_LINE' ? (node.side ?? null) : null,
    inReplyToExternalId:
      source === 'REVIEW_LINE' && node.in_reply_to_id
        ? String(node.in_reply_to_id)
        : null,
    // LUM-1003: who the reviewer is to the repo, for agent-context trust tiers.
    authorAssociation: authorAssociationOf(node),
  })

  const { commentService } = await import('@/lib/services/comment.service')
  await commentService.notifyMentionsForMirror({
    commentId: comment.id,
    taskId: payload.taskId,
    body,
    authorActorId: author.actorId,
    workspaceId: payload.workspaceId,
  })

  if (missing) {
    // Re-attempt the parent linkage after a short delay
    await prCommentSyncJobRepository.enqueue({
      direction: 'INBOUND',
      payload: {
        reason: 'parent-mirror-missing',
        commentId: comment.id,
        pullRequestId: payload.pullRequestId,
        raw: payload.raw,
      },
      externalId: String(node.id),
      workspaceId: payload.workspaceId,
      scheduledFor: new Date(Date.now() + 30_000),
    })
  }
  // LUM-879: routed while the repository was confirmed; it may have left the
  // list (and had its comments scrubbed) since.
  await scrubCommentsIfRepositoryUnconfirmed(payload.pullRequestId)
}

async function applyInboundUpdate(
  payload: InboundPayload,
  existing: { id: string; commentId: string },
  node: InboundCommentNode
) {
  const source = payloadSource(payload)
  const newBody = buildInboundBody(payload, node, source)
  await commentRepository.update(existing.commentId, { body: newBody })
  await prCommentMirrorRepository.patchAfterEdit(
    existing.id,
    new Date(node.updated_at),
    computeBodyHash(node.body ?? ''),
    authorAssociationOf(node)
  )
  // LUM-879: same recheck as a create — the edit may land after a scrub.
  await scrubCommentsIfRepositoryUnconfirmed(payload.pullRequestId)
}

async function runInboundUpdate(
  payload: InboundPayload,
  existing: { id: string; commentId: string; externalUpdatedAt: Date },
  node: InboundCommentNode
) {
  const T = new Date(node.updated_at)
  const M = existing.externalUpdatedAt

  // T <= M: echo — drop
  if (T <= M) return

  const local = await commentRepository.findById(existing.commentId)
  if (!local || local.deletedAt) return // local was deleted; inbound update is moot

  const L = local.updatedAt

  if (L <= M) {
    // No local edits since last sync — apply inbound unconditionally
    return applyInboundUpdate(payload, existing, node)
  }

  if (T > L) {
    // GH timestamp is newer than local edit → GH wins
    logger.warn('pr-mirror conflict: inbound wins', {
      mirrorId: existing.id,
      L: L.toISOString(),
      M: M.toISOString(),
      T: T.toISOString(),
      localBody: local.body,
      remoteBody: node.body,
    })
    return applyInboundUpdate(payload, existing, node)
  }

  // L >= T > M: local is newer → local wins; push local back to GitHub
  await prCommentSyncJobRepository.enqueue({
    direction: 'OUTBOUND',
    payload: { op: 'UPDATE', mirrorId: existing.id },
    commentId: existing.commentId,
    workspaceId: payload.workspaceId,
  })
}

/** Core inbound processing logic, extracted so the drain helper can call it
 *  without re-triggering the top-level drain pass (which would cause infinite recursion). */
async function runInboundCore(payload: InboundPayload) {
  const node = extractCommentNode(payload)
  const source = payloadSource(payload)

  // DELETE always wins — no conflict matrix needed
  if (payload.action === 'deleted') {
    const existingForDelete = await prCommentMirrorRepository.findByExternal(
      source,
      String(node.id)
    )
    if (!existingForDelete) return // unknown comment, ignore
    await commentRepository.delete(existingForDelete.commentId)
    await prCommentMirrorRepository.markDeleted(existingForDelete.id)
    return
  }

  // Echo / dedupe via exact externalId match
  const existing = await prCommentMirrorRepository.findByExternal(
    source,
    String(node.id)
  )
  if (existing) {
    const tIncoming = new Date(node.updated_at)
    if (existing.externalUpdatedAt >= tIncoming) return // echo — drop

    // UPDATE path — handled in Task 14
    return runInboundUpdate(payload, existing, node)
  }

  // Race-patch: did we just POST this comment and the webhook beat the response?
  if (payload.action === 'created' || payload.action === 'submitted') {
    const placeholder = await prCommentMirrorRepository.findRecentPlaceholder(
      payload.pullRequestId,
      computeBodyHash(node.body ?? ''),
      60
    )
    if (placeholder) {
      await prCommentMirrorRepository.resolvePlaceholder(placeholder.id, {
        externalId: String(node.id),
        externalNodeId: node.node_id,
        externalUrl: node.html_url,
        externalUpdatedAt: new Date(node.updated_at),
      })
      return
    }
  }

  if (
    payload.action === 'created' ||
    payload.action === 'submitted' ||
    payload.action === 'edited' // edit on something we don't know — treat as create
  ) {
    return runInboundCreate(payload, node, source)
  }
}

export const prCommentMirrorService = {
  async runOutbound(commentId: string, op: 'CREATE' | 'UPDATE' | 'DELETE') {
    // Drain pending OUTBOUND jobs for the same task before proceeding.
    const comment = await commentRepository.findById(commentId)
    if (comment?.taskId) await drainOutboundForTask(comment.taskId)

    if (op === 'CREATE') return runOutboundCreate(commentId)
    if (op === 'UPDATE') return runOutboundUpdate(commentId)
    if (op === 'DELETE') return runOutboundDelete(commentId)
  },

  async resolveInboundAuthor(
    workspaceId: string,
    ghUser: { id: number; login: string; type: string; avatar_url: string }
  ): Promise<{ actorId: string } | null> {
    // Bot defense: skip events from the Lumo bot itself to prevent infinite loops
    if (ghUser.login === BOT_LOGIN) return null

    // Check if this GitHub login maps to a Lumo member
    const integration = await githubRepository.findIntegrationByLogin(
      workspaceId,
      ghUser.login
    )
    if (integration?.member?.actor?.id) {
      return { actorId: integration.member.actor.id }
    }

    // Fall back to a GITHUB_USER pseudo-actor
    const actor = await githubActorService.upsertPseudoActor(workspaceId, {
      id: ghUser.id,
      login: ghUser.login,
      avatar_url: ghUser.avatar_url,
    })
    return { actorId: actor.id }
  },

  async runInbound(payload: InboundPayload) {
    // Drain pending INBOUND jobs for the same PR before proceeding.
    await drainInboundForPr(payload.pullRequestId)
    return runInboundCore(payload)
  },

  async scheduleOutbound(
    commentId: string,
    op: 'CREATE' | 'UPDATE' | 'DELETE',
    opts: { mirrorOrigin?: 'inbound' | 'user' } = {}
  ) {
    if (opts.mirrorOrigin === 'inbound') return
    waitUntil(
      prCommentMirrorService
        .runOutbound(commentId, op)
        .catch(err =>
          console.error('[pr-mirror] outbound failed', { commentId, op, err })
        )
    )
  },
}
