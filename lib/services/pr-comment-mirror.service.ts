import { githubRepository } from '@/lib/repositories/github.repository'
import { decrypt } from '@/lib/crypto'
import { getGithubInstallationToken } from '@/lib/integrations/github/auth'
import type { OutboundActorKind } from '@prisma/client'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { prCommentMirrorRepository } from '@/lib/repositories/pr-comment-mirror.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  lumoHtmlToGithubMarkdown,
  computeBodyHash,
} from '@/lib/integrations/github/markdown-bridge'
import {
  prCommentClient,
  GithubApiError,
} from '@/lib/integrations/github/pr-comment-client'
import { prCommentSyncJobRepository } from '@/lib/repositories/pr-comment-sync-job.repository'
import { prisma } from '@/lib/db/prisma'

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
    throw new Error('DELETE not yet implemented')
  },

  async runInbound(_payload: unknown) {
    throw new Error('not implemented — Task 12-15')
  },

  async scheduleOutbound(
    _commentId: string,
    _op: 'CREATE' | 'UPDATE' | 'DELETE',
    _opts: { mirrorOrigin?: 'inbound' | 'user' } = {}
  ) {
    throw new Error('not implemented — Task 16')
  },
}
