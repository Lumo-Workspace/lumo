import { trashRepository } from '@/lib/repositories/trash.repository'
import { logger } from '@/lib/logger'

/** LUM-918: how long a deleted task / document stays restorable. */
export const TRASH_RETENTION_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

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
    return { kind, id: root.id, parentId: root.parentTaskId }
  }
  const root = await trashRepository.findDocumentRoot(workspaceId, id)
  // A document's trash belongs to its owner, like its delete button.
  if (!root || root.createdById !== memberId) {
    throw httpError('Not found in trash', 404)
  }
  return { kind, id: root.id, parentId: root.parentId }
}

async function purge(kind: TrashKind, id: string): Promise<number> {
  return kind === 'task'
    ? trashRepository.purgeTaskGroup(id)
    : trashRepository.purgeDocumentGroup(id)
}

// ── Trash Service (LUM-918) ─────────────────────────────────────────────────

export const trashService = {
  /** Delete = move to trash, with every live subtask. */
  async trashTask(taskId: string, clerkId: string, now: Date = new Date()) {
    return trashRepository.trashTask(taskId, {
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
    return trashRepository.trashDocument(documentId, {
      deletedAt: now,
      deletedByClerkId: clerkId,
    })
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
      await trashRepository.restoreTask(root.id, root.parentId)
    } else {
      await trashRepository.restoreDocument(root.id, root.parentId)
    }
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

  /** Cron: hard-delete everything that has been in the trash 30 days. */
  async purgeExpired(now: Date = new Date()) {
    const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * DAY_MS)
    const { taskIds, documentIds } =
      await trashRepository.findExpiredRoots(cutoff)
    let purged = 0
    let failed = 0
    const roots = [
      ...taskIds.map(id => ['task', id] as const),
      ...documentIds.map(id => ['document', id] as const),
    ]
    for (const [kind, id] of roots) {
      try {
        purged += await purge(kind, id)
      } catch (error) {
        failed++
        logger.error('[trash] purge failed', {
          kind,
          id,
          error: (error as Error).message,
        })
      }
    }
    return { roots: roots.length, purged, failed }
  },
}
