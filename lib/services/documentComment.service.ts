import { documentCommentRepository } from '@/lib/repositories/documentComment.repository'
import { documentRepository } from '@/lib/repositories/document.repository'
import { pushDocumentEvent } from '@/lib/integrations/pusher/server'
import {
  assertOnlyCommentMarksChanged,
  extractCommentIds,
  removeCommentSpan,
} from '@/lib/editor/comment-mark-html'
import type { DocumentCommentStatus } from '@prisma/client'

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

function notFound(): never {
  throw Object.assign(new Error('Document not found'), { status: 404 })
}

export const documentCommentService = {
  async getComments(documentId: string, memberId: string, workspaceId: string) {
    const doc = await documentRepository.findWithPermission(
      documentId,
      memberId,
      workspaceId
    )
    if (!doc) notFound()
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
      // The new content must add exactly the new comment id and nothing else.
      const added = [...newIds].filter(id => !oldIds.has(id))
      const removed = [...oldIds].filter(id => !newIds.has(id))
      const addedId = added[0]
      if (removed.length > 0 || added.length !== 1 || addedId !== input.id) {
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
    return comment
  },

  async updateCommentWithSideEffects(args: {
    commentId: string
    memberId: string
    workspaceId: string
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
