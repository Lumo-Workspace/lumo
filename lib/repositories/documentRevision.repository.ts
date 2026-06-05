import { prisma } from '@/lib/db/prisma'

export interface CreateRevisionData {
  documentId: string
  workspaceId: string
  authorId: string
  content: string | null
  title: string
  emoji: string | null
  label?: string | null
  isManual?: boolean
  wordCount?: number | null
}

export interface UpdateRevisionContentData {
  content: string | null
  title: string
  emoji: string | null
  wordCount?: number | null
}

export interface PrunableRevisionRow {
  id: string
  createdAt: Date
  isManual: boolean
}

export const documentRevisionRepository = {
  create(data: CreateRevisionData) {
    return prisma.documentRevision.create({
      data: {
        documentId: data.documentId,
        workspaceId: data.workspaceId,
        authorId: data.authorId,
        content: data.content,
        title: data.title,
        emoji: data.emoji ?? null,
        label: data.label ?? null,
        isManual: data.isManual ?? false,
        wordCount: data.wordCount ?? null,
      },
    })
  },

  findLatestForDocument(documentId: string) {
    return prisma.documentRevision.findFirst({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
    })
  },

  updateContent(id: string, data: UpdateRevisionContentData) {
    // `updatedAt` (@updatedAt) auto-refreshes -> slides the merge window.
    return prisma.documentRevision.update({
      where: { id },
      data: {
        content: data.content,
        title: data.title,
        emoji: data.emoji ?? null,
        wordCount: data.wordCount ?? null,
      },
    })
  },

  listByDocument(documentId: string) {
    return prisma.documentRevision.findMany({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        isManual: true,
        authorId: true,
        title: true,
        emoji: true,
        wordCount: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, clerkId: true } },
      },
    })
  },

  findByIdWithContent(id: string, documentId: string) {
    return prisma.documentRevision.findFirst({
      where: { id, documentId },
    })
  },

  listForPrune(documentId: string): Promise<PrunableRevisionRow[]> {
    return prisma.documentRevision.findMany({
      where: { documentId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, isManual: true },
    })
  },

  async listDocumentIdsWithRevisions(): Promise<string[]> {
    const rows = await prisma.documentRevision.findMany({
      distinct: ['documentId'],
      select: { documentId: true },
    })
    return rows.map(r => r.documentId)
  },

  deleteByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve({ count: 0 })
    return prisma.documentRevision.deleteMany({ where: { id: { in: ids } } })
  },
}
