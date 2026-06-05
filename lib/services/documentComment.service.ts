import { documentCommentRepository } from '@/lib/repositories/documentComment.repository'
import { documentRepository } from '@/lib/repositories/document.repository'
import { memberRepository, notificationRepository } from '@/lib/repositories'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { pushDocumentEvent } from '@/lib/integrations/pusher/server'
import {
  assertOnlyCommentMarksChanged,
  extractCommentIds,
  removeCommentSpan,
} from '@/lib/editor/comment-mark-html'
import type { DocumentCommentStatus } from '@prisma/client'
import { shouldNotifyBatch } from '@/lib/services/notification.service'
import { sendDMNotification } from '@/lib/integrations/slack'
import { getActorClerkId } from '@/lib/actor'
import { buildDocumentUrl } from '@/lib/utils/buildDocumentUrl'

type WaitUntil = (p: Promise<unknown>) => void

export interface CreateDocCommentInput {
  id: string
  body: string
  parentId?: string | undefined
  from?: number | undefined
  to?: number | undefined
  quotedText?: string | undefined
  content?: string | undefined
}

export interface CreateDocCommentArgs {
  documentId: string
  memberId: string
  workspaceId: string
  authorActorId: string | null
  input: CreateDocCommentInput
  waitUntil: WaitUntil
}

interface NotifyDocMentionsParams {
  documentId: string
  documentCommentId: string
  body: string
  authorActorId: string
  workspaceId: string
  docTitle: string
  workspaceSlug: string
  docSlug: string
  waitUntil: WaitUntil
}

/** Parse @mention clerkIds from comment body HTML. Excludes author and __agent__. */
function parseMentionedClerkIds(body: string, authorClerkId: string): string[] {
  const mentionRegex = /data-type="mention"[^>]*data-id="([^"]+)"/g
  const ids: string[] = []
  let match: RegExpExecArray | null
  while ((match = mentionRegex.exec(body)) !== null) {
    const clerkId = match[1]
    if (
      clerkId &&
      clerkId !== authorClerkId &&
      clerkId !== '__agent__' &&
      !ids.includes(clerkId)
    ) {
      ids.push(clerkId)
    }
  }
  return ids
}

function notFound(): never {
  throw Object.assign(new Error('Document not found'), { status: 404 })
}

export const documentCommentService = {
  /**
   * Process @mention notifications for a document comment.
   * Sends inbox and Slack DM notifications to mentioned users.
   */
  async notifyDocMentions(params: NotifyDocMentionsParams): Promise<void> {
    const {
      documentId,
      documentCommentId,
      body,
      authorActorId,
      workspaceId,
      docTitle,
      workspaceSlug,
      docSlug,
      waitUntil,
    } = params

    const authorClerkId = await getActorClerkId(authorActorId)
    const mentionedIds = parseMentionedClerkIds(body, authorClerkId ?? '')
    if (mentionedIds.length === 0) return

    const members = await memberRepository.findByWorkspaceAndClerkIds(
      workspaceId,
      mentionedIds
    )
    if (members.length === 0) return

    const docUrl = buildDocumentUrl(workspaceSlug, docSlug)
    const mentionPayload = {
      taskTitle: docTitle,
      taskUrl: docUrl,
      commentBody: body.replace(/<[^>]+>/g, '').slice(0, 200),
    }

    const recipientActors = members
      .map(m => m.actor?.id)
      .filter((actorId): actorId is string => !!actorId)

    // Batch preference checks for inApp and slack channels
    const [inAppAllowed, slackAllowed] = await Promise.all([
      shouldNotifyBatch(recipientActors, 'inApp', 'DOCUMENT_COMMENT_MENTIONED'),
      shouldNotifyBatch(recipientActors, 'slack', 'DOCUMENT_COMMENT_MENTIONED'),
    ])

    // Slack DM — only to users who have slack mention enabled
    for (const m of members) {
      if (m.actor?.id && slackAllowed.has(m.actor.id)) {
        waitUntil(
          sendDMNotification(
            workspaceId,
            m.clerkId,
            'comment_mention',
            mentionPayload
          )
        )
      }
    }

    // Inbox notifications — only for users who have inApp mention enabled
    const inAppRecipients = recipientActors.filter(id => inAppAllowed.has(id))
    if (inAppRecipients.length === 0) return

    await notificationRepository.createMany(
      inAppRecipients.map(recipientActorId => ({
        workspaceId,
        recipientActorId,
        type: 'DOCUMENT_COMMENT_MENTIONED' as const,
        documentId,
        documentCommentId,
        triggerActorId: authorActorId,
      }))
    )
  },

  async getComments(documentId: string, memberId: string, workspaceId: string) {
    const doc = await documentRepository.findWithPermission(
      documentId,
      memberId,
      workspaceId
    )
    if (!doc) notFound()
    // Refresh orphan flags against the current document content before returning.
    await documentCommentService.detectAndFlagOrphans(documentId, doc.content)
    return documentCommentRepository.findByDocumentId(documentId)
  },

  async createCommentWithSideEffects(args: CreateDocCommentArgs) {
    const {
      documentId,
      memberId,
      workspaceId,
      authorActorId,
      input,
      waitUntil,
    } = args

    const doc = await documentRepository.findWithPermission(
      documentId,
      memberId,
      workspaceId
    )
    if (!doc) notFound()

    const isReply = !!input.parentId

    if (isReply) {
      const parentId = input.parentId
      const parent = await documentCommentRepository.findById(parentId!)
      if (!parent || parent.deletedAt) {
        throw Object.assign(new Error('Parent comment not found'), {
          status: 404,
        })
      }
      if (parent.documentId !== documentId) {
        throw Object.assign(
          new Error('Parent comment belongs to another document'),
          { status: 400 }
        )
      }
      if (parent.parentId !== null) {
        throw Object.assign(new Error('Cannot reply to a reply'), {
          status: 400,
        })
      }
    }

    if (!isReply) {
      if (!input.content) {
        throw Object.assign(
          new Error('content is required for an anchored comment'),
          { status: 400 }
        )
      }
      assertOnlyCommentMarksChanged(doc.content ?? '', input.content)
      const oldIds = new Set(extractCommentIds(doc.content ?? ''))
      const newIds = new Set(extractCommentIds(input.content))
      // No existing marks may be removed, no OTHER new marks may appear, and
      // the target id must be present. We intentionally allow the target id to
      // already be in stored content (autosave-won race: the debounced save
      // already persisted the mark before this request arrived).
      const removed = [...oldIds].filter(id => !newIds.has(id))
      const addedOther = [...newIds].filter(
        id => !oldIds.has(id) && id !== input.id
      )
      if (
        removed.length > 0 ||
        addedOther.length > 0 ||
        !newIds.has(input.id)
      ) {
        throw Object.assign(
          new Error('content must add exactly the new comment mark'),
          { status: 400 }
        )
      }
      await documentRepository.update(documentId, { content: input.content })
    }

    const comment = await documentCommentRepository.create({
      id: input.id,
      documentId,
      authorActorId,
      body: input.body,
      parentId: input.parentId ?? null,
      quotedText: isReply ? null : (input.quotedText ?? null),
      anchorStart: isReply ? null : (input.from ?? null),
      anchorEnd: isReply ? null : (input.to ?? null),
    })

    waitUntil(
      pushDocumentEvent(documentId, {
        type: 'doc-comment:created',
        commentId: comment.id,
      })
    )

    // Fire-and-forget: DOCUMENT_COMMENT_MENTIONED notifications for @mention chips
    const ws = await workspaceRepository.findNameAndSlug(workspaceId)
    documentCommentService
      .notifyDocMentions({
        documentId,
        documentCommentId: comment.id,
        body: input.body,
        authorActorId: authorActorId ?? '',
        workspaceId,
        docTitle: doc.title ?? '',
        workspaceSlug: ws?.slug ?? '',
        docSlug: doc.slug,
        waitUntil,
      })
      .catch(err =>
        console.error('[notify] DOCUMENT_COMMENT_MENTIONED failed:', err)
      )

    return comment
  },

  async updateCommentWithSideEffects(args: {
    commentId: string
    memberId: string
    workspaceId: string
    actorId: string | null
    body: string
    waitUntil: WaitUntil
  }) {
    const existing = await documentCommentRepository.findById(args.commentId)
    if (!existing) {
      throw Object.assign(new Error('Comment not found'), { status: 404 })
    }
    const doc = await documentRepository.findWithPermission(
      existing.documentId,
      args.memberId,
      args.workspaceId
    )
    if (!doc) notFound()

    if (existing.authorActorId && existing.authorActorId !== args.actorId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }

    const updated = await documentCommentRepository.update(args.commentId, {
      body: args.body,
    })
    args.waitUntil(
      pushDocumentEvent(existing.documentId, {
        type: 'doc-comment:updated',
        commentId: args.commentId,
      })
    )
    return updated
  },

  async deleteCommentWithSideEffects(args: {
    commentId: string
    memberId: string
    workspaceId: string
    actorId: string | null
    waitUntil: WaitUntil
  }) {
    const existing = await documentCommentRepository.findById(args.commentId)
    if (!existing) {
      throw Object.assign(new Error('Comment not found'), { status: 404 })
    }
    const doc = await documentRepository.findWithPermission(
      existing.documentId,
      args.memberId,
      args.workspaceId
    )
    if (!doc) notFound()

    if (existing.authorActorId && existing.authorActorId !== args.actorId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }

    if (!existing.parentId && doc.content) {
      const stripped = removeCommentSpan(doc.content, args.commentId)
      if (stripped !== doc.content) {
        await documentRepository.update(existing.documentId, {
          content: stripped,
        })
      }
    }

    await documentCommentRepository.softDelete(args.commentId)
    args.waitUntil(
      pushDocumentEvent(existing.documentId, {
        type: 'doc-comment:deleted',
        commentId: args.commentId,
      })
    )
    return { ok: true }
  },

  async setStatusWithSideEffects(args: {
    commentId: string
    status: DocumentCommentStatus
    memberId: string
    workspaceId: string
    actorId: string | null
    waitUntil: WaitUntil
  }) {
    const existing = await documentCommentRepository.findById(args.commentId)
    if (!existing) {
      throw Object.assign(new Error('Comment not found'), { status: 404 })
    }
    const doc = await documentRepository.findWithPermission(
      existing.documentId,
      args.memberId,
      args.workspaceId
    )
    if (!doc) notFound()

    const updated = await documentCommentRepository.setStatus(
      args.commentId,
      args.status,
      args.actorId
    )
    args.waitUntil(
      pushDocumentEvent(existing.documentId, {
        type: 'doc-comment:status',
        commentId: args.commentId,
        status: args.status,
      })
    )
    return updated
  },

  async detectAndFlagOrphans(documentId: string, content: string | null) {
    const present = new Set(extractCommentIds(content ?? ''))
    const threads = await documentCommentRepository.findByDocumentId(documentId)
    const orphanIds: string[] = []
    const healedIds: string[] = []
    for (const t of threads) {
      if (!present.has(t.id) && !t.isOrphaned) orphanIds.push(t.id)
      if (present.has(t.id) && t.isOrphaned) healedIds.push(t.id)
    }
    if (orphanIds.length)
      await documentCommentRepository.setOrphaned(orphanIds, true)
    if (healedIds.length)
      await documentCommentRepository.setOrphaned(healedIds, false)
    return { orphanIds, healedIds }
  },
}
