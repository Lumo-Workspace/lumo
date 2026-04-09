import { type DocVisibility, type DocShareRole } from '@prisma/client'
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

  /** Update document with optional child reordering and mention sync, all in a single transaction. */
  async updateWithChildrenAndMentions(
    id: string,
    updateData: Record<string, unknown>,
    childOrder: string[] | undefined,
    mentionTaskIds: string[] | undefined
  ) {
    return prisma.$transaction(async tx => {
      const updatedDoc =
        Object.keys(updateData).length > 0
          ? await tx.document.update({ where: { id }, data: updateData })
          : await tx.document.findUniqueOrThrow({ where: { id } })

      // Reorder children if childOrder is provided
      if (childOrder) {
        for (let i = 0; i < childOrder.length; i++) {
          await tx.document.update({
            where: { id: childOrder[i]! },
            data: { sortOrder: i },
          })
        }
      }

      // Sync mentions if mentionTaskIds is provided
      if (mentionTaskIds !== undefined) {
        const existing = await tx.documentMention.findMany({
          where: { documentId: id },
          select: { taskId: true },
        })
        const existingIds = new Set(existing.map(m => m.taskId))
        const newIds = new Set(mentionTaskIds)

        // Delete removed mentions
        const toDelete = [...existingIds].filter(mid => !newIds.has(mid))
        if (toDelete.length > 0) {
          await tx.documentMention.deleteMany({
            where: { documentId: id, taskId: { in: toDelete } },
          })
        }

        // Create new mentions
        const toCreate = [...newIds].filter(mid => !existingIds.has(mid))
        if (toCreate.length > 0) {
          await tx.documentMention.createMany({
            data: toCreate.map(taskId => ({ documentId: id, taskId })),
          })
        }
      }

      return updatedDoc
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

  /** Find a document node by ID (for tree traversal, parentId only). */
  async findParentId(id: string) {
    return prisma.document.findUnique({
      where: { id },
      select: { id: true, parentId: true },
    })
  },

  /** Find tree nodes (documents matching a filter, for sidebar tree). */
  async findTreeNodes(filter: Record<string, unknown>) {
    return prisma.document.findMany({
      where: filter,
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        title: true,
        emoji: true,
        parentId: true,
        sortOrder: true,
        _count: { select: { children: true } },
      },
    })
  },

  /** Find a document the member can manage (owner or MANAGER share). */
  async findManageable(id: string, memberId: string, workspaceId: string) {
    return prisma.document.findFirst({
      where: {
        id,
        workspaceId,
        OR: [
          { createdById: memberId },
          { shares: { some: { memberId, role: 'MANAGER' } } },
        ],
      },
    })
  },

  /** Find a document the member can edit (owner, WORKSPACE visibility, or EDITOR/MANAGER share). */
  async findEditable(id: string, memberId: string, workspaceId: string) {
    return prisma.document.findFirst({
      where: {
        id,
        workspaceId,
        OR: [
          { createdById: memberId },
          { visibility: 'WORKSPACE' },
          {
            shares: {
              some: {
                memberId,
                role: { in: ['EDITOR', 'MANAGER'] },
              },
            },
          },
        ],
      },
    })
  },

  /** Find all shares for a document with member info. */
  async findSharesByDocument(documentId: string) {
    return prisma.documentShare.findMany({
      where: { documentId },
      include: {
        member: {
          select: { id: true, clerkId: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    })
  },

  /** Create or update a document share in a transaction (auto-sets visibility to SHARED if PRIVATE). */
  async upsertShareTransaction(
    documentId: string,
    memberId: string,
    role: DocShareRole,
    currentVisibility: string
  ) {
    return prisma.$transaction(async tx => {
      if (currentVisibility === 'PRIVATE') {
        await tx.document.update({
          where: { id: documentId },
          data: { visibility: 'SHARED' },
        })
      }

      return tx.documentShare.upsert({
        where: {
          documentId_memberId: { documentId, memberId },
        },
        create: { documentId, memberId, role },
        update: { role },
        include: {
          member: {
            select: { id: true, clerkId: true },
          },
        },
      })
    })
  },

  /** Update a document share's role. */
  async updateShare(shareId: string, role: DocShareRole) {
    return prisma.documentShare.update({
      where: { id: shareId },
      data: { role },
    })
  },

  /** Delete a document share. */
  async deleteShare(shareId: string) {
    return prisma.documentShare.delete({ where: { id: shareId } })
  },

  /** Move a document (update parentId and sortOrder). */
  async move(id: string, parentId: string | null, sortOrder: number) {
    return prisma.document.update({
      where: { id },
      data: { parentId, sortOrder },
    })
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
