import { trashRepository } from '@/lib/repositories/trash.repository'
import { privateFileService } from '@/lib/services/private-file.service'
import { logger } from '@/lib/logger'

/** LUM-918: how long a deleted task / document stays restorable. */
export const TRASH_RETENTION_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
/** LUM-923: expired trash roots loaded per page by the purge cron. */
export const PURGE_PAGE_SIZE = 100

export type TrashKind = 'task' | 'document'

export interface TrashItemView {
  kind: TrashKind
  id: string
  /** `LUM-42` for a task, the title for a document. */
  label: string
  title: string
  emoji: string | null
  deletedAt: string
  /** When the purge cron hard-deletes it. */
  purgeAt: string
  /** Subtasks / sub-pages that went to the trash with it. */
  descendantCount: number
}

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

export function purgeAtFor(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + TRASH_RETENTION_DAYS * DAY_MS)
}

/** Resolve a trash root the caller may act on, or throw 404. */
async function requireRoot(
  kind: TrashKind,
  id: string,
  workspaceId: string,
  memberId: string
) {
  if (kind === 'task') {
    const root = await trashRepository.findTaskRoot(workspaceId, id)
    if (!root) throw httpError('Not found in trash', 404)
    // LUM-959: tasks have no parent any more.
    return { kind, id: root.id, parentId: null }
  }
  const root = await trashRepository.findDocumentRoot(workspaceId, id)
  // A document's trash belongs to its owner, like its delete button.
  if (!root || root.createdById !== memberId) {
    throw httpError('Not found in trash', 404)
  }
  return { kind, id: root.id, parentId: root.parentId }
}

/** Live descendants of `rootId`, breadth first. */
async function collectDescendants(
  findChildren: (ids: string[]) => Promise<string[]>,
  rootId: string
): Promise<string[]> {
  const out: string[] = []
  let frontier = [rootId]
  while (frontier.length > 0) {
    const children = await findChildren(frontier)
    out.push(...children)
    frontier = children
  }
  return out
}

async function purge(
  kind: TrashKind,
  id: string,
  opts: { expiredBefore?: Date } = {}
): Promise<number> {
  if (kind === 'document') return trashRepository.purgeDocumentGroup(id, opts)
  // Read before the delete: the test cases cascade away with the tasks.
  const withEvidence = await trashRepository.findTaskGroupIdsWithTestCases(id)
  const purged = await trashRepository.purgeTaskGroup(id, opts)
  // Re-checked inside the delete: nothing went, so no evidence goes either.
  if (purged === 0) return 0
  // LUM-916: evidence blobs go with the rows. Moving to the trash keeps
  // them so a restore is whole; only the hard delete sweeps them.
  await privateFileService.deleteTaskEvidence(withEvidence)
  return purged
}

// ── Trash Service (LUM-918) ─────────────────────────────────────────────────

export const trashService = {
  /**
   * Delete = move to trash. LUM-959: a task is trashed alone (no subtasks);
   * groups trashed before that still restore and purge as a whole.
   */
  async trashTask(taskId: string, clerkId: string, now: Date = new Date()) {
    await trashRepository.markTaskGroupTrashed(taskId, [], {
      deletedAt: now,
      deletedByClerkId: clerkId,
    })
  },

  /** Delete = move to trash, with every live sub-page. */
  async trashDocument(
    documentId: string,
    clerkId: string,
    now: Date = new Date()
  ) {
    const descendants = await collectDescendants(
      trashRepository.findChildDocumentIds,
      documentId
    )
    await trashRepository.markDocumentGroupTrashed(documentId, descendants, {
      deletedAt: now,
      deletedByClerkId: clerkId,
    })
    return descendants.length
  },

  /**
   * The caller's trash: every trashed task of the workspace, and the
   * trashed documents they own. Only roots — descendants ride along.
   */
  async list(workspaceId: string, memberId: string): Promise<TrashItemView[]> {
    const [tasks, documents] = await Promise.all([
      trashRepository.listTaskRoots(workspaceId),
      trashRepository.listDocumentRoots(workspaceId),
    ])
    const items: TrashItemView[] = [
      ...tasks.map(t => ({
        kind: 'task' as const,
        id: t.id,
        label: `${t.teamIdentifier}-${t.number}`,
        title: t.title,
        emoji: null,
        deletedAt: t.deletedAt.toISOString(),
        purgeAt: purgeAtFor(t.deletedAt).toISOString(),
        descendantCount: t.descendantCount,
      })),
      ...documents
        .filter(d => d.createdById === memberId)
        .map(d => ({
          kind: 'document' as const,
          id: d.id,
          label: d.title,
          title: d.title,
          emoji: d.emoji,
          deletedAt: d.deletedAt.toISOString(),
          purgeAt: purgeAtFor(d.deletedAt).toISOString(),
          descendantCount: d.descendantCount,
        })),
    ]
    return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  },

  async restore(
    kind: TrashKind,
    id: string,
    workspaceId: string,
    memberId: string
  ) {
    const root = await requireRoot(kind, id, workspaceId, memberId)
    if (kind === 'task') {
      await trashRepository.restoreTask(root.id)
      return
    }
    // A document whose parent is gone (trashed separately, or purged) comes
    // back top-level rather than under a parent nobody can see.
    const parentLive = !root.parentId
      ? true
      : await trashRepository.isDocumentLive(root.parentId)
    await trashRepository.restoreDocument(root.id, {
      detachFromParent: !parentLive,
    })
  },

  /** Permanently delete now — the immediate-erasure path for one item. */
  async deletePermanently(
    kind: TrashKind,
    id: string,
    workspaceId: string,
    memberId: string
  ) {
    const root = await requireRoot(kind, id, workspaceId, memberId)
    return purge(kind, root.id)
  },

  /**
   * Cron: hard-delete everything that has been in the trash 30 days. Roots
   * are walked a page at a time, and each purge re-checks its root is still
   * expired (LUM-923) — a restore or re-trash after the scan wins.
   */
  async purgeExpired(now: Date = new Date()) {
    const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS)
    let roots = 0
    let purged = 0
    let failed = 0
    for (const kind of ['task', 'document'] as const) {
      let afterId: string | null = null
      for (;;) {
        const page: string[] = await trashRepository.findExpiredRootPage(
          kind,
          cutoff,
          PURGE_PAGE_SIZE,
          afterId
        )
        for (const id of page) {
          roots++
          try {
            purged += await purge(kind, id, { expiredBefore: cutoff })
          } catch (error) {
            failed++
            logger.error('[trash] purge failed', {
              kind,
              id,
              error: (error as Error).message,
            })
          }
        }
        if (page.length < PURGE_PAGE_SIZE) break
        afterId = page[page.length - 1]!
      }
    }
    return { roots, purged, failed }
  },
}
