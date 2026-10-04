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

/**
 * LUM-923: a big document tree is deleted row by row; Prisma's 5s default
 * would time it out on every daily run and it would never leave the trash.
 */
const PURGE_TX_OPTIONS = { timeout: 120_000, maxWait: 10_000 } as const

type RootCounter = {
  count: (args: { where: Record<string, unknown> }) => Promise<number>
}

/** Still a trash root — and, for the cron, still past its retention. */
async function isPurgeableRoot(
  delegate: RootCounter,
  rootId: string,
  expiredBefore: Date | undefined
): Promise<boolean> {
  const n = await delegate.count({
    where: {
      id: rootId,
      trashRootId: null,
      deletedAt: expiredBefore ? { lte: expiredBefore } : { not: null },
    },
  })
  return n === 1
}

const groupWhere = (rootId: string) => ({
  deletedAt: { not: null },
  OR: [{ id: rootId }, { trashRootId: rootId }],
})

// ── Trash Repository (LUM-918) ──────────────────────────────────────────────

export const trashRepository = {
  /** Ids of the live documents whose parent is one of `parentIds`. */
  async findChildDocumentIds(parentIds: string[]): Promise<string[]> {
    const rows = await prisma.document.findMany({
      where: { parentId: { in: parentIds } },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /** Stamp a task group trashed: the root, and members pointing at it. */
  async markTaskGroupTrashed(
    rootId: string,
    memberIds: string[],
    stamp: TrashStamp
  ): Promise<void> {
    await prisma.$transaction(async tx => {
      await tx.task.update({
        where: { id: rootId },
        data: { ...stamp, trashRootId: null },
      })
      if (memberIds.length > 0) {
        await tx.task.updateMany({
          where: { id: { in: memberIds } },
          data: { ...stamp, trashRootId: rootId },
        })
      }
    })
  },

  /** Stamp a document group trashed: the root, and members pointing at it. */
  async markDocumentGroupTrashed(
    rootId: string,
    memberIds: string[],
    stamp: TrashStamp
  ): Promise<void> {
    await prisma.$transaction(async tx => {
      await tx.document.update({
        where: { id: rootId },
        data: { ...stamp, trashRootId: null },
      })
      if (memberIds.length > 0) {
        await tx.document.updateMany({
          where: { id: { in: memberIds } },
          data: { ...stamp, trashRootId: rootId },
        })
      }
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
      select: { id: true },
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

  /** Whether a document is live (exists and is not in the trash). */
  async isDocumentLive(documentId: string): Promise<boolean> {
    return (await prisma.document.count({ where: { id: documentId } })) === 1
  },

  /** Clear the trash stamp of a task group. */
  async restoreTask(rootId: string) {
    await prisma.task.updateMany({
      where: groupWhere(rootId),
      data: { deletedAt: null, trashRootId: null, deletedByClerkId: null },
    })
  },

  /** Clear the trash stamp of a document group; optionally detach the root. */
  async restoreDocument(rootId: string, opts: { detachFromParent: boolean }) {
    await prisma.$transaction(async tx => {
      await tx.document.updateMany({
        where: groupWhere(rootId),
        data: { deletedAt: null, trashRootId: null, deletedByClerkId: null },
      })
      if (opts.detachFromParent) {
        await tx.document.update({
          where: { id: rootId },
          data: { parentId: null },
        })
      }
    })
  },

  /** Tasks of a trashed group that have test cases (evidence blobs). */
  async findTaskGroupIdsWithTestCases(rootId: string): Promise<string[]> {
    const rows = await prisma.task.findMany({
      where: { ...groupWhere(rootId), testCases: { some: {} } },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },

  /**
   * Hard-delete a trashed task group; related rows cascade as before. With
   * `expiredBefore` (the cron) the root is re-checked in the same transaction:
   * one restored, or trashed again, since the scan is left alone (LUM-923).
   */
  async purgeTaskGroup(
    rootId: string,
    opts: { expiredBefore?: Date } = {}
  ): Promise<number> {
    return prisma.$transaction(async (tx: Tx) => {
      if (!(await isPurgeableRoot(tx.task, rootId, opts.expiredBefore))) {
        return 0
      }
      const { count } = await tx.task.deleteMany({
        where: groupWhere(rootId),
      })
      return count
    }, PURGE_TX_OPTIONS)
  },

  /**
   * Hard-delete a trashed document group: mentions, shares and editors
   * first, then the documents children-first (the tree FK does not cascade).
   */
  async purgeDocumentGroup(
    rootId: string,
    opts: { expiredBefore?: Date } = {}
  ): Promise<number> {
    return prisma.$transaction(async (tx: Tx) => {
      if (!(await isPurgeableRoot(tx.document, rootId, opts.expiredBefore))) {
        return 0
      }
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
    }, PURGE_TX_OPTIONS)
  },

  /**
   * One page of trash roots of `kind` deleted at or before `before`, in id
   * order after `afterId` — the cron walks them page by page (LUM-923)
   * instead of loading every expired root at once.
   */
  async findExpiredRootPage(
    kind: 'task' | 'document',
    before: Date,
    take: number,
    afterId: string | null
  ): Promise<string[]> {
    const args = {
      where: {
        deletedAt: { lte: before },
        trashRootId: null,
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' as const },
      take,
    }
    const rows =
      kind === 'task'
        ? await prisma.task.findMany(args)
        : await prisma.document.findMany(args)
    return rows.map(r => r.id)
  },
}
