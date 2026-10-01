import { documentCommentRepository } from '@/lib/repositories/documentComment.repository'
import { documentRepository } from '@/lib/repositories/document.repository'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { pushDocumentEvent } from '@/lib/integrations/pusher/server'
import {
  assertOnlyCommentMarksChanged,
  extractCommentIds,
  removeCommentSpan,
} from '@/lib/editor/comment-mark-html'
import type { DocumentCommentStatus } from '@prisma/client'
import { notifyMentionDelta } from '@/lib/services/mention-notify.service'
import { getActorClerkId } from '@/lib/actor'
import { buildDocumentUrl } from '@/lib/utils/buildDocumentUrl'
import { sanitizeCommentHtml } from '@/lib/html/sanitize-comment-html'

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

    const docUrl = buildDocumentUrl(workspaceSlug, docSlug)
    const mentionPayload = {
      taskTitle: docTitle,
      taskUrl: docUrl,
      commentBody: body.replace(/<[^>]+>/g, '').slice(0, 200),
    }

    // DM + inbox + realtime via the shared core (comment create ⇒ oldHtml = '').
    await notifyMentionDelta({
      oldHtml: '',
      newHtml: body,
      authorClerkId: authorClerkId ?? '',
      authorActorId,
      workspaceId,
      notificationType: 'DOCUMENT_COMMENT_MENTIONED',
      ref: { documentId, documentCommentId },
      slackEvent: 'comment_mention',
      slackPayload: mentionPayload,
      waitUntil,
    })
  },

  async getComments(documentId: string, memberId: string, workspaceId: string) {
    const doc = await documentRepository.findWithPermission(
      documentId,
      memberId,
      workspaceId
    )
    if (!doc) notFound()
    // findWithPermission accepts an id OR a slug, so `documentId` may be a slug.
    // Use the resolved doc.id for all id-based repo lookups below.
    // Refresh orphan flags against the current document content before returning.
    await documentCommentService.detectAndFlagOrphans(doc.id, doc.content)
    return documentCommentRepository.findByDocumentId(doc.id)
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
    // findWithPermission accepts an id OR a slug, so `documentId` may be a slug.
    // Resolve to the real doc.id for every id-based repo write/compare below —
    // otherwise document.update({ where: { id: slug } }) throws Prisma P2025.
    const docId = doc.id

    const isReply = !!input.parentId

    if (isReply) {
      const parentId = input.parentId
      const parent = await documentCommentRepository.findById(parentId!)
      if (!parent || parent.deletedAt) {
        throw Object.assign(new Error('Parent comment not found'), {
          status: 404,
        })
      }
      if (parent.documentId !== docId) {
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
      await documentRepository.update(docId, { content: input.content })
    }

    // LUM-921: member/agent-authored HTML — store only the allowlisted subset.
    const body = sanitizeCommentHtml(input.body)
    const comment = await documentCommentRepository.create({
      id: input.id,
      documentId: docId,
      authorActorId,
      body,
      parentId: input.parentId ?? null,
      quotedText: isReply ? null : (input.quotedText ?? null),
      anchorStart: isReply ? null : (input.from ?? null),
      anchorEnd: isReply ? null : (input.to ?? null),
    })

    waitUntil(
      pushDocumentEvent(docId, {
        type: 'doc-comment:created',
        commentId: comment.id,
      })
    )

    // Fire-and-forget: DOCUMENT_COMMENT_MENTIONED notifications for @mention chips
    const ws = await workspaceRepository.findNameAndSlug(workspaceId)
    documentCommentService
      .notifyDocMentions({
        documentId: docId,
        documentCommentId: comment.id,
        body,
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

    // Author-only. A null authorActorId means no owner can be established, so
    // nobody may edit — the old `authorActorId && ...` guard short-circuited on
    // null and let any workspace member through.
    if (!existing.authorActorId || existing.authorActorId !== args.actorId) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }

    const updated = await documentCommentRepository.update(args.commentId, {
      body: sanitizeCommentHtml(args.body),
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

    // Author-only — reject a null-author comment for everyone (see update above).
    if (!existing.authorActorId || existing.authorActorId !== args.actorId) {
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
      // Tombstoned parents (kept alive only to host live replies) have had their
      // anchor span stripped already — never flag them as orphaned.
      if (t.deletedAt) continue
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
