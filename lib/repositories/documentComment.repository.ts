import { prisma } from '@/lib/db/prisma'
import type { DocumentCommentStatus } from '@prisma/client'

export interface CreateDocumentCommentData {
  id: string
  documentId: string
  authorActorId: string | null
  body: string
  parentId?: string | null
  quotedText?: string | null
  anchorStart?: number | null
  anchorEnd?: number | null
}

// Matches the ACTOR_SELECT shape established in activity.repository.ts
const AUTHOR_SELECT = {
  author: {
    select: {
      id: true,
      type: true,
      member: { select: { id: true, clerkId: true } },
      agent: { select: { id: true, name: true, avatarColor: true } },
    },
  },
} as const

export const documentCommentRepository = {
  async findByDocumentId(documentId: string) {
    return prisma.documentComment.findMany({
      where: { documentId, parentId: null, deletedAt: null },
      include: {
        ...AUTHOR_SELECT,
        replies: {
          where: { deletedAt: null },
          include: AUTHOR_SELECT,
          orderBy: { createdAt: 'asc' as const },
        },
      },
      orderBy: { createdAt: 'asc' as const },
    })
  },

  async findById(id: string) {
    return prisma.documentComment.findUnique({
      where: { id },
      include: AUTHOR_SELECT,
    })
  },

  async create(data: CreateDocumentCommentData) {
    return prisma.documentComment.create({
      data: {
        id: data.id,
        documentId: data.documentId,
        authorActorId: data.authorActorId,
        body: data.body,
        parentId: data.parentId ?? null,
        quotedText: data.quotedText ?? null,
        anchorStart: data.anchorStart ?? null,
        anchorEnd: data.anchorEnd ?? null,
      },
      include: AUTHOR_SELECT,
    })
  },

  async update(id: string, data: { body: string }) {
    return prisma.documentComment.update({
      where: { id },
      data: { body: data.body },
      include: AUTHOR_SELECT,
    })
  },

  async softDelete(id: string) {
    return prisma.documentComment.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
  },

  async setStatus(
    id: string,
    status: DocumentCommentStatus,
    actorId: string | null
  ) {
    const resolving = status === 'RESOLVED'
    return prisma.documentComment.update({
      where: { id },
      data: {
        status,
        resolvedByActorId: resolving ? actorId : null,
        resolvedAt: resolving ? new Date() : null,
      },
      include: AUTHOR_SELECT,
    })
  },

  async setOrphaned(ids: string[], isOrphaned: boolean) {
    if (ids.length === 0) return { count: 0 }
    return prisma.documentComment.updateMany({
      where: { id: { in: ids } },
      data: { isOrphaned },
    })
  },
}
