import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

export interface TrashStamp {
  deletedAt: Date
  deletedByClerkId: string
}

export interface TrashedTaskRow {
  id: string
  number: number
  title: string
  teamIdentifier: string
  deletedAt: Date
  deletedByClerkId: string | null
  descendantCount: number
}

export interface TrashedDocumentRow {
  id: string
  title: string
  emoji: string | null
  createdById: string
  deletedAt: Date
  deletedByClerkId: string | null
  descendantCount: number
}

/** Live descendants of `rootId` along `parentField`, breadth first. */
async function collectDescendants(
  findChildren: (ids: string[]) => Promise<{ id: string }[]>,
  rootId: string
): Promise<string[]> {
  const out: string[] = []
  let frontier = [rootId]
  while (frontier.length > 0) {
    const children = (await findChildren(frontier)).map(c => c.id)
    out.push(...children)
    frontier = children
  }
  return out
}

/** Group ids ordered so that every child comes before its parent. */
function childrenFirst(
  rows: { id: string; parentId: string | null }[],
  rootId: string
): string[] {
  const byParent = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.parentId) continue
    byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r.id])
  }
  const order: string[] = []
  const visit = (id: string) => {
    for (const child of byParent.get(id) ?? []) visit(child)
    order.push(id)
  }
  visit(rootId)
  // Rows of the group no longer under the root (re-parented) go first.
  const seen = new Set(order)
  return [...rows.map(r => r.id).filter(id => !seen.has(id)), ...order]
}

const groupWhere = (rootId: string) => ({
  deletedAt: { not: null },
  OR: [{ id: rootId }, { trashRootId: rootId }],
})

// ── Trash Repository (LUM-918) ──────────────────────────────────────────────

export const trashRepository = {
  /** Move a live task and all its live subtasks (recursively) to the trash. */
  async trashTask(taskId: string, stamp: TrashStamp): Promise<number> {
    return prisma.$transaction(async tx => {
      const descendants = await collectDescendants(
        ids =>
          tx.task.findMany({
            where: { parentTaskId: { in: ids } },
            select: { id: true },
          }),
        taskId
      )
      await tx.task.update({
        where: { id: taskId },
        data: { ...stamp, trashRootId: null },
      })
      if (descendants.length > 0) {
        await tx.task.updateMany({
          where: { id: { in: descendants } },
          data: { ...stamp, trashRootId: taskId },
        })
      }
      return descendants.length
    })
  },

  /** Move a live document and all its live sub-pages to the trash. */
  async trashDocument(documentId: string, stamp: TrashStamp): Promise<number> {
    return prisma.$transaction(async tx => {
      const descendants = await collectDescendants(
        ids =>
          tx.document.findMany({
            where: { parentId: { in: ids } },
            select: { id: true },
          }),
        documentId
      )
      await tx.document.update({
        where: { id: documentId },
        data: { ...stamp, trashRootId: null },
      })
      if (descendants.length > 0) {
        await tx.document.updateMany({
          where: { id: { in: descendants } },
          data: { ...stamp, trashRootId: documentId },
        })
      }
      return descendants.length
    })
  },

  /** Trashed task roots of a workspace, newest first. */
  async listTaskRoots(workspaceId: string): Promise<TrashedTaskRow[]> {
    const rows = await prisma.task.findMany({
      where: {
        deletedAt: { not: null },
        trashRootId: null,
        project: { workspaceId },
      },
      select: {
        id: true,
        number: true,
        title: true,
        deletedAt: true,
        deletedByClerkId: true,
        team: { select: { identifier: true } },
      },
      orderBy: { deletedAt: 'desc' },
    })
    const counts = await prisma.task.groupBy({
      by: ['trashRootId'],
      where: {
        deletedAt: { not: null },
        trashRootId: { in: rows.map(r => r.id) },
      },
      _count: { _all: true },
    })
    const countOf = new Map(counts.map(c => [c.trashRootId, c._count._all]))
    return rows.map(r => ({
      id: r.id,
      number: r.number,
      title: r.title,
      teamIdentifier: r.team.identifier,
      deletedAt: r.deletedAt!,
      deletedByClerkId: r.deletedByClerkId,
      descendantCount: countOf.get(r.id) ?? 0,
    }))
  },

  /** Trashed document roots of a workspace, newest first. */
  async listDocumentRoots(workspaceId: string): Promise<TrashedDocumentRow[]> {
    const rows = await prisma.document.findMany({
      where: { deletedAt: { not: null }, trashRootId: null, workspaceId },
      select: {
        id: true,
        title: true,
        emoji: true,
        createdById: true,
        deletedAt: true,
        deletedByClerkId: true,
      },
      orderBy: { deletedAt: 'desc' },
    })
    const counts = await prisma.document.groupBy({
      by: ['trashRootId'],
      where: {
        deletedAt: { not: null },
        trashRootId: { in: rows.map(r => r.id) },
      },
      _count: { _all: true },
    })
    const countOf = new Map(counts.map(c => [c.trashRootId, c._count._all]))
    return rows.map(r => ({
      ...r,
      deletedAt: r.deletedAt!,
      descendantCount: countOf.get(r.id) ?? 0,
    }))
  },

  /** A trashed task root in the workspace, or null. */
  async findTaskRoot(workspaceId: string, taskId: string) {
    return prisma.task.findFirst({
      where: {
        id: taskId,
        deletedAt: { not: null },
        trashRootId: null,
        project: { workspaceId },
      },
      select: { id: true, parentTaskId: true },
    })
  },

  /** A trashed document root in the workspace, or null. */
  async findDocumentRoot(workspaceId: string, documentId: string) {
    return prisma.document.findFirst({
      where: {
        id: documentId,
        deletedAt: { not: null },
        trashRootId: null,
        workspaceId,
      },
      select: { id: true, parentId: true, createdById: true },
    })
  },

  /**
   * Bring a trashed task group back. A root whose parent is gone (trashed or
   * purged) comes back top-level rather than under a hidden parent.
   */
  async restoreTask(rootId: string, parentTaskId: string | null) {
    await prisma.$transaction(async tx => {
      const parentLive = parentTaskId
        ? (await tx.task.count({ where: { id: parentTaskId } })) === 1
        : true
      await tx.task.updateMany({
        where: groupWhere(rootId),
        data: { deletedAt: null, trashRootId: null, deletedByClerkId: null },
      })
      if (!parentLive) {
        await tx.task.update({
          where: { id: rootId },
          data: { parentTaskId: null },
        })
      }
    })
  },

  /** Bring a trashed document group back (same rule for a missing parent). */
  async restoreDocument(rootId: string, parentId: string | null) {
    await prisma.$transaction(async tx => {
      const parentLive = parentId
        ? (await tx.document.count({ where: { id: parentId } })) === 1
        : true
      await tx.document.updateMany({
        where: groupWhere(rootId),
        data: { deletedAt: null, trashRootId: null, deletedByClerkId: null },
      })
      if (!parentLive) {
        await tx.document.update({
          where: { id: rootId },
          data: { parentId: null },
        })
      }
    })
  },

  /** Hard-delete a trashed task group; related rows cascade as before. */
  async purgeTaskGroup(rootId: string): Promise<number> {
    const { count } = await prisma.task.deleteMany({
      where: groupWhere(rootId),
    })
    return count
  },

  /**
   * Hard-delete a trashed document group: mentions, shares and editors
   * first, then the documents children-first (the tree FK does not cascade).
   */
  async purgeDocumentGroup(rootId: string): Promise<number> {
    return prisma.$transaction(async (tx: Tx) => {
      const rows = await tx.document.findMany({
        where: groupWhere(rootId),
        select: { id: true, parentId: true },
      })
      const ids = rows.map(r => r.id)
      if (ids.length === 0) return 0
      await tx.documentMention.deleteMany({
        where: { documentId: { in: ids } },
      })
      await tx.documentShare.deleteMany({ where: { documentId: { in: ids } } })
      await tx.documentEditor.deleteMany({ where: { documentId: { in: ids } } })
      for (const id of childrenFirst(rows, rootId)) {
        await tx.document.delete({ where: { id } })
      }
      return ids.length
    })
  },

  /** Trash roots (both kinds) deleted at or before `before`. */
  async findExpiredRoots(before: Date) {
    const where = { deletedAt: { lte: before }, trashRootId: null }
    const [tasks, documents] = await Promise.all([
      prisma.task.findMany({ where, select: { id: true } }),
      prisma.document.findMany({ where, select: { id: true } }),
    ])
    return {
      taskIds: tasks.map(t => t.id),
      documentIds: documents.map(d => d.id),
    }
  },
}
