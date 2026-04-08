import { type DocVisibility } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

// ── Types ───────────────────────────────────────────────────────────────────

export interface CreateDocumentData {
  title: string
  emoji?: string | null
  parentId?: string | null
  projectId?: string | null
  workspaceId: string
  createdById: string
  visibility: DocVisibility
  sortOrder: number
}

export interface DocumentFilters {
  visibility?: string
  projectId?: string
  parentId?: string | null
  search?: string
  rootOnly?: boolean
}

// ── Shared includes ─────────────────────────────────────────────────────────

const DOCUMENT_LIST_INCLUDE = {
  project: { select: { id: true, name: true } },
  createdBy: { select: { id: true, clerkId: true } },
  shares: {
    include: {
      member: { select: { id: true, clerkId: true } },
    },
  },
  editors: {
    select: {
      member: { select: { id: true, clerkId: true } },
      lastEditedAt: true,
    },
    orderBy: { lastEditedAt: 'desc' as const },
    take: 5,
  },
  _count: { select: { children: true } },
} as const

const DOCUMENT_DETAIL_INCLUDE = {
  project: { select: { id: true, name: true } },
  createdBy: { select: { id: true, clerkId: true } },
  children: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      title: true,
      emoji: true,
      parentId: true,
      sortOrder: true,
      updatedAt: true,
      _count: { select: { children: true } },
    },
  },
  shares: {
    include: {
      member: { select: { id: true, clerkId: true } },
    },
  },
  _count: { select: { children: true } },
} as const

// ── Repository ──────────────────────────────────────────────────────────────

export const documentRepository = {
  /** Find documents in workspace with permission filtering. */
  async findByWorkspace(
    workspaceId: string,
    memberId: string,
    filters?: DocumentFilters
  ) {
    const where: Record<string, unknown> = {
      workspaceId,
      OR: [
        { createdById: memberId },
        { visibility: 'WORKSPACE' as const },
        { shares: { some: { memberId } } },
      ],
    }

    if (filters?.visibility === 'PRIVATE') {
      where.createdById = memberId
      where.visibility = 'PRIVATE'
      delete where.OR
    } else if (filters?.visibility === 'SHARED') {
      where.visibility = 'SHARED'
    } else if (filters?.visibility === 'WORKSPACE') {
      where.visibility = 'WORKSPACE'
    }

    if (filters?.projectId) where.projectId = filters.projectId
    if (filters?.parentId) where.parentId = filters.parentId
    if (filters?.parentId === null || filters?.rootOnly) {
      where.parentId = null
    }
    if (filters?.search) {
      where.title = { contains: filters.search, mode: 'insensitive' }
    }

    return prisma.document.findMany({
      where,
      include: DOCUMENT_LIST_INCLUDE,
      orderBy: [{ updatedAt: 'desc' }],
    })
  },

  /** Find document with permission check (includes children, shares, project, creator). */
  async findWithPermission(id: string, memberId: string, workspaceId: string) {
    return prisma.document.findFirst({
      where: {
        id,
        workspaceId,
        OR: [
          { createdById: memberId },
          { visibility: 'WORKSPACE' },
          { shares: { some: { memberId } } },
        ],
      },
      include: DOCUMENT_DETAIL_INCLUDE,
    })
  },

  /** Find a publicly shared document by its public token. */
  async findByPublicToken(token: string) {
    return prisma.document.findUnique({
      where: { publicToken: token },
      select: {
        title: true,
        emoji: true,
        content: true,
      },
    })
  },

  /** Find document for basic existence check. */
  async findById(id: string, workspaceId: string) {
    return prisma.document.findFirst({
      where: { id, workspaceId },
    })
  },

  /** Get max sortOrder among sibling documents. */
  async getMaxSortOrder(workspaceId: string, parentId: string | null) {
    const maxSibling = await prisma.document.findFirst({
      where: { parentId, workspaceId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    })
    return maxSibling?.sortOrder ?? 0
  },

  /** Create a new document. */
  async create(data: CreateDocumentData) {
    return prisma.document.create({
      data: {
        title: data.title,
        emoji: data.emoji ?? null,
        parentId: data.parentId ?? null,
        projectId: data.projectId ?? null,
        workspaceId: data.workspaceId,
        createdById: data.createdById,
        visibility: data.visibility,
        sortOrder: data.sortOrder,
      },
      include: {
        project: { select: { id: true, name: true } },
        createdBy: { select: { id: true, clerkId: true } },
        _count: { select: { children: true } },
      },
    })
  },

  /** Update document fields. */
  async update(id: string, data: Record<string, unknown>) {
    return prisma.document.update({
      where: { id },
      data,
    })
  },

  /** Delete document and all descendants recursively in a transaction. */
  async deleteWithDescendants(id: string, _workspaceId: string) {
    await prisma.$transaction(async tx => {
      // Recursively collect all descendant IDs
      const toDelete: string[] = [id]
      let currentIds = [id]
      while (currentIds.length > 0) {
        const children = await tx.document.findMany({
          where: { parentId: { in: currentIds } },
          select: { id: true },
        })
        const childIds = children.map(c => c.id)
        toDelete.push(...childIds)
        currentIds = childIds
      }

      // Delete mentions, shares, editors, then documents (deepest first)
      await tx.documentMention.deleteMany({
        where: { documentId: { in: toDelete } },
      })
      await tx.documentShare.deleteMany({
        where: { documentId: { in: toDelete } },
      })
      await tx.documentEditor.deleteMany({
        where: { documentId: { in: toDelete } },
      })
      for (let i = toDelete.length - 1; i >= 0; i--) {
        const deleteId = toDelete[i]!
        await tx.document.delete({ where: { id: deleteId } })
      }
    })
  },

  /** Find ancestor chain for a document. Walks parent chain with loop prevention. */
  async findAncestors(parentId: string | null) {
    const ancestors: {
      id: string
      title: string
      emoji: string | null
      children: {
        id: string
        title: string
        emoji: string | null
        _count: { children: number }
      }[]
    }[] = []

    let currentParentId = parentId
    const visitedIds = new Set<string>()

    while (currentParentId && !visitedIds.has(currentParentId)) {
      visitedIds.add(currentParentId)
      const parent = await prisma.document.findUnique({
        where: { id: currentParentId },
        select: {
          id: true,
          title: true,
          emoji: true,
          parentId: true,
          children: {
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              title: true,
              emoji: true,
              _count: { select: { children: true } },
            },
          },
        },
      })
      if (!parent) break
      ancestors.unshift({
        id: parent.id,
        title: parent.title,
        emoji: parent.emoji,
        children: parent.children,
      })
      currentParentId = parent.parentId
    }

    return ancestors
  },

  /** Upsert document editor tracking. */
  async upsertEditor(documentId: string, memberId: string) {
    return prisma.documentEditor.upsert({
      where: {
        documentId_memberId: { documentId, memberId },
      },
      update: { lastEditedAt: new Date() },
      create: { documentId, memberId },
    })
  },
}
