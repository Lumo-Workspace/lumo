import { githubRepository } from '@/lib/repositories/github.repository'
import { decrypt } from '@/lib/crypto'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
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
} from '@/lib/integrations/github/markdown-bridge'
import {
  prCommentClient,
  GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'
import { prisma } from '@/lib/db/prisma'
import { githubActorService } from '@/lib/services/github-actor.service'

interface Repo {
  owner: string
  name: string
}

interface OutboundActorResult {
  actor: OutboundActorKind
  token: string
  userId: string | null
}

const CACHE_TTL_MS = 10 * 60 * 1000
const writeCache = new Map<string, { until: number; canWrite: boolean }>()

async function canWriteRepo(token: string, repo: Repo): Promise<boolean> {
  const key = `${token.slice(0, 8)}:${repo.owner}/${repo.name}`
  const cached = writeCache.get(key)
  if (cached && cached.until > Date.now()) return cached.canWrite
  const res = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.name}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    }
  )
  if (!res.ok) {
    writeCache.set(key, { until: Date.now() + CACHE_TTL_MS, canWrite: false })
    return false
  }
  const body = (await res.json()) as { permissions?: { push?: boolean } }
  const canWrite = body.permissions?.push === true
  writeCache.set(key, { until: Date.now() + CACHE_TTL_MS, canWrite })
  return canWrite
}

interface ResolveActorInput {
  workspaceId: string
  authorUserId: string
  repo: Repo
}

/** Exposed only for testing — clears the in-process write-permission cache. */
export function _clearWriteCacheForTesting() {
  writeCache.clear()
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
    const row = await prisma.workspaceMember.findUnique({
      where: { id: member.id },
      select: { clerkId: true },
    })
    if (!row?.clerkId) return 'Someone'
    const { clerkClient } = await import('@clerk/nextjs/server')
    const client = await clerkClient()
    const user = await client.users.getUser(row.clerkId)
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

async function buildOutboundBody(
  comment: { body: string; authorActorId: string | null },
  actor: OutboundActorKind,
  commentUrl: string
): Promise<{ body: string; bodyHash: string }> {
  const rendered = lumoHtmlToGithubMarkdown(comment.body, _clerkId => {
    // resolver: clerkId → github login (best-effort; null for unknowns)
    return null
  })

  if (actor === 'USER_OAUTH') {
    return { body: rendered, bodyHash: computeBodyHash(rendered) }
  }

  // BOT_APP: prefix with author attribution
  const authorName = comment.authorActorId
    ? await resolveAuthorDisplayName(comment.authorActorId)
    : 'Someone'
  const prefixed = `**[${authorName}](${commentUrl}) 在 Lumo 说：**\n\n${rendered}`
  return { body: prefixed, bodyHash: computeBodyHash(prefixed) }
}

async function runOutboundCreate(commentId: string) {
  const comment = await commentRepository.findById(commentId)
  if (!comment) return
  if (comment.type === 'AGENT') return

  const pr = await pullRequestRepository.findByTaskId(comment.taskId)
  if (!pr) return

  const repo = parseRepo(pr.repo)

  // Determine if this is a review-line reply
  let parentMirror: { externalSource: string; externalId: string } | null = null
  if (comment.parentId) {
    parentMirror = await prCommentMirrorRepository.findByCommentId(
      comment.parentId
    )
  }
  const isReviewLineReply = parentMirror?.externalSource === 'REVIEW_LINE'

  // Resolve outbound actor identity. findByActorId returns { id, workspaceId } — no extra args.
  const memberForActor = comment.authorActorId
    ? await memberRepository.findByActorId(comment.authorActorId)
    : null
  const actorResult = memberForActor
    ? await prCommentMirrorService.resolveOutboundActor({
        workspaceId: pr.workspaceId,
        authorUserId: memberForActor.id,
        repo,
      })
    : {
        actor: 'BOT_APP' as const,
        token: await getGithubInstallationToken(),
        userId: null,
      }

  const commentUrl = ''
  const { body, bodyHash } = await buildOutboundBody(
    comment,
    actorResult.actor,
    commentUrl
  )

  // Reserve mirror BEFORE the GitHub call
  const mirror = await prCommentMirrorRepository.reserve({
    commentId,
    pullRequestId: pr.id,
    externalSource: isReviewLineReply ? 'REVIEW_LINE' : 'ISSUE',
    outboundActor: actorResult.actor,
    outboundActorUserId: actorResult.userId,
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
          token: actorResult.token,
        })
      : await prCommentClient.createIssueComment({
          repo,
          prNumber: pr.number,
          body,
          token: actorResult.token,
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
  const mirror = await prCommentMirrorRepository.findByCommentId(commentId)
  if (!mirror) return // never mirrored — nothing to push

  const pr = await pullRequestRepository.findByTaskId(comment.taskId)
  if (!pr) return
  const repo = parseRepo(pr.repo)

  // Reuse same actor resolution logic as CREATE; fall back to BOT_APP with app token
  const memberForActor = comment.authorActorId
    ? await memberRepository.findByActorId(comment.authorActorId)
    : null
  const actorResult = memberForActor
    ? await prCommentMirrorService.resolveOutboundActor({
        workspaceId: pr.workspaceId,
        authorUserId: memberForActor.id,
        repo,
      })
    : {
        actor: 'BOT_APP' as const,
        token: await getGithubInstallationToken(),
        userId: null,
      }

  const { body, bodyHash } = await buildOutboundBody(
    comment,
    actorResult.actor,
    ''
  )

  try {
    const response =
      mirror.externalSource === 'REVIEW_LINE'
        ? await prCommentClient.updateReviewLineComment({
            repo,
            externalId: mirror.externalId,
            body,
            token: actorResult.token,
          })
        : await prCommentClient.updateIssueComment({
            repo,
            externalId: mirror.externalId,
            body,
            token: actorResult.token,
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

  const pr = await pullRequestRepository.findByTaskId(comment.taskId)
  if (!pr) return

  const repo = parseRepo(pr.repo)

  // For DELETE: prefer the same actor that wrote the comment (mirror.outboundActor).
  // If USER_OAUTH user is no longer available, fall back to BOT_APP token.
  let token: string
  if (mirror.outboundActor === 'USER_OAUTH' && mirror.outboundActorUserId) {
    const memberForActor = comment.authorActorId
      ? await memberRepository.findByActorId(comment.authorActorId)
      : null
    if (memberForActor) {
      const actorResult = await prCommentMirrorService.resolveOutboundActor({
        workspaceId: pr.workspaceId,
        authorUserId: memberForActor.id,
        repo,
      })
      token = actorResult.token
    } else {
      // getGithubInstallationToken() takes no args (lib/integrations/github/auth.ts:7)
      token = await getGithubInstallationToken()
    }
  } else {
    token = await getGithubInstallationToken()
  }

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

const BOT_LOGIN = process.env.LUMO_GITHUB_BOT_LOGIN ?? 'lumo-app[bot]'

interface InboundPayload {
  event:
    | 'issue_comment'
    | 'pull_request_review'
    | 'pull_request_review_comment'
  action: 'created' | 'edited' | 'deleted' | 'submitted' | 'dismissed'
  workspaceId: string
  taskId: string
  pullRequestId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any
}

interface InboundCommentNode {
  id: number
  node_id: string
  html_url: string
  body: string | null
  updated_at: string
  user: { id: number; login: string; type: string; avatar_url: string }
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

function payloadSource(payload: InboundPayload): PrCommentSource {
  if (payload.event === 'issue_comment') return 'ISSUE'
  if (payload.event === 'pull_request_review') return 'REVIEW'
  return 'REVIEW_LINE'
}

function buildInboundBody(
  payload: InboundPayload,
  node: InboundCommentNode,
  source: PrCommentSource
): string {
  const md = node.body ?? ''
  const innerHtml = githubMarkdownToLumoHtml(md, () => null) // mention resolver wired later

  if (source === 'REVIEW_LINE' && node.path && node.line) {
    const headerInner = `📍 在 <a href="${node.html_url}">${node.path}:${node.line}</a> 评论`
    return buildHeader(headerInner) + innerHtml
  }

  if (source === 'REVIEW') {
    const state = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload.raw.review?.state as string | undefined
    )?.toLowerCase()
    let header = '💬 Commented'
    if (state === 'approved') header = '✅ Approved'
    else if (state === 'changes_requested') header = '🛑 Requested changes'
    else if (state === 'dismissed') header = '📭 Review dismissed'
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

  const comment = await prisma.$transaction(async tx => {
    const c = await commentRepository.create({
      taskId: payload.taskId,
      authorActorId: author.actorId,
      body,
      parentId,
      quotedCommentId: null,
    })
    await prCommentMirrorRepository.create(
      {
        commentId: c.id,
        pullRequestId: payload.pullRequestId,
        externalSource: source,
        externalId: String(node.id),
        externalNodeId: node.node_id,
        externalUrl: node.html_url,
        externalUpdatedAt: new Date(node.updated_at),
        outboundActor: 'BOT_APP', // origin: external; outbound writer unknown
        outboundActorUserId: null,
        bodyHash: computeBodyHash(node.body ?? ''),
        filePath: source === 'REVIEW_LINE' ? (node.path ?? null) : null,
        lineStart:
          source === 'REVIEW_LINE'
            ? (node.start_line ?? node.line ?? null)
            : null,
        lineEnd: source === 'REVIEW_LINE' ? (node.line ?? null) : null,
        diffSide: source === 'REVIEW_LINE' ? (node.side ?? null) : null,
        inReplyToExternalId:
          source === 'REVIEW_LINE' && node.in_reply_to_id
            ? String(node.in_reply_to_id)
            : null,
      },
      tx
    )
    return c
  })

  if (missing) {
    // Re-attempt the parent linkage after a short delay
    await prCommentSyncJobRepository.enqueue({
      direction: 'INBOUND',
      payload: {
        reason: 'parent-mirror-missing',
        commentId: comment.id,
        raw: payload.raw,
      },
      externalId: String(node.id),
      workspaceId: payload.workspaceId,
      scheduledFor: new Date(Date.now() + 30_000),
    })
  }

  // TODO(LUM-90 Task 18): commentService.notifyMentionsForMirror({ commentId: comment.id, workspaceId: payload.workspaceId })
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
    computeBodyHash(node.body ?? '')
  )
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
    console.warn('pr-mirror conflict: inbound wins', {
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

export const prCommentMirrorService = {
  async resolveOutboundActor(
    input: ResolveActorInput
  ): Promise<OutboundActorResult> {
    const integration =
      await githubRepository.findIntegrationByUserAndWorkspace(
        input.workspaceId,
        input.authorUserId
      )
    if (integration) {
      const token = decrypt(integration.accessToken)
      if (await canWriteRepo(token, input.repo)) {
        return { actor: 'USER_OAUTH', token, userId: input.authorUserId }
      }
    }
    // getGithubInstallationToken() takes no args (single Lumo App installation; see lib/integrations/github/auth.ts:7)
    const appToken = await getGithubInstallationToken()
    return { actor: 'BOT_APP', token: appToken, userId: null }
  },

  async runOutbound(commentId: string, op: 'CREATE' | 'UPDATE' | 'DELETE') {
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
  },

  async scheduleOutbound(
    commentId: string,
    op: 'CREATE' | 'UPDATE' | 'DELETE',
    opts: { mirrorOrigin?: 'inbound' | 'user' } = {}
  ) {
    if (opts.mirrorOrigin === 'inbound') return
    waitUntil(
      prCommentMirrorService.runOutbound(commentId, op).catch(err =>
        console.error('[pr-mirror] outbound failed', { commentId, op, err })
      )
    )
  },
}
