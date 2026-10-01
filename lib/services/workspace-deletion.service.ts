import {
  workspaceDeletionRepository,
  type BlobCleanup,
  type PendingDeletion,
} from '@/lib/repositories/workspace-deletion.repository'
import { workspaceExportRepository } from '@/lib/repositories/workspace-export.repository'
import { logger } from '@/lib/logger'
import type { DeletionNotice } from '@/lib/services/workspace-deletion-notice'

const ERROR_MAX_CHARS = 500

/** LUM-918: how long a requested workspace deletion stays cancellable. */
export const WORKSPACE_DELETION_GRACE_MS = 48 * 60 * 60 * 1000

/** The workspace fields the deletion flow needs from the caller. */
export interface DeletionWorkspace {
  id: string
  name: string
  slug: string
}

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

function requireOwner(role: string) {
  if (role !== 'OWNER') {
    throw httpError('Only admins can delete a workspace', 403)
  }
}

async function notifyOwners(
  kind: DeletionNotice['kind'],
  workspace: DeletionWorkspace,
  actorClerkId: string,
  pending: PendingDeletion
) {
  try {
    // Loaded on use, like the blob wrapper: keeps the email SDK out of every
    // test that merely imports this service.
    const { sendDeletionNotice } =
      await import('@/lib/services/workspace-deletion-notice')
    await sendDeletionNotice({
      kind,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceSlug: workspace.slug,
      actorClerkId,
      ownerClerkIds: await workspaceDeletionRepository.findOwnerClerkIds(
        workspace.id
      ),
      requestedAt: pending.requestedAt,
      executeAt: pending.executeAt,
    })
  } catch (error) {
    logger.error('[workspace-deletion] owner notice failed', {
      workspaceId: workspace.id,
      kind,
      error: (error as Error).message,
    })
  }
}

/** Blob prefixes a workspace owns: its folder (logo, editor images, exports)
 *  and each task's evidence — swept in both stores (LUM-916). */
export function workspaceBlobPrefixes(
  workspaceId: string,
  taskIdsWithTestCases: readonly string[]
): string[] {
  return [
    `workspaces/${workspaceId}/`,
    ...taskIdsWithTestCases.map(id => `test-evidence/${id}/`),
  ]
}

async function cleanupBlobs(prefixes: readonly string[]): Promise<BlobCleanup> {
  let deleted = 0
  try {
    // Loaded on use: @vercel/blob pulls in undici, which breaks every jsdom
    // test that merely imports workspace.service.
    const { deleteBlobsByPrefixInBothStores } =
      await import('@/lib/services/workspace-deletion-blob')
    for (const prefix of prefixes)
      deleted += await deleteBlobsByPrefixInBothStores(prefix)
    return { status: 'DONE', deleted }
  } catch (error) {
    const message = (error as Error).message ?? String(error)
    return {
      status: 'FAILED',
      deleted,
      error: message.slice(0, ERROR_MAX_CHARS),
    }
  }
}

/**
 * LUM-923: the agent-facing line for a pending deletion — injected at session
 * start and in `lumo task context`, so a CLI / agent working in the 48h window
 * knows the workspace is about to go. Empty when nothing is pending.
 */
export function renderPendingDeletionSection(
  pending: PendingDeletion | null
): string {
  if (!pending) return ''
  return [
    '## Workspace scheduled for deletion',
    '',
    `This workspace will be permanently deleted at ${pending.executeAt.toISOString()} (UTC) — every task, document, session and memory with it. An owner can still cancel from Settings until then; tell the user before starting long-running work here.`,
  ].join('\n')
}

// ── Workspace Deletion Service (LUM-861) ────────────────────────────────────

export const workspaceDeletionService = {
  /**
   * Permanently delete a workspace and everything it owns, then its blobs.
   * The DB delete + receipt commit together; blob cleanup runs after the
   * commit and never rolls it back — its outcome is settled on the receipt.
   */
  async deleteWorkspace(
    workspaceId: string,
    requestedByClerkId: string,
    opts: { dueBy?: Date } = {}
  ) {
    // LUM-923: an export still generating would upload its archive after
    // the blob sweep below and leave a full copy of the workspace behind.
    // Failing it first makes that run delete its own upload instead.
    await workspaceExportRepository.invalidateActive(
      workspaceId,
      'workspace is being deleted'
    )
    const taskIds =
      await workspaceDeletionRepository.findTaskIdsWithTestCases(workspaceId)
    const purged = await workspaceDeletionRepository.purge(
      workspaceId,
      requestedByClerkId,
      opts
    )
    // LUM-918: cancelled after the cron picked it up — nothing was deleted.
    if (!purged) return null
    const { receiptId, rowCounts } = purged

    const blobCleanup = await cleanupBlobs(
      workspaceBlobPrefixes(workspaceId, taskIds)
    )
    if (blobCleanup.status === 'FAILED') {
      logger.warn('[workspace-deletion] blob cleanup failed', {
        receiptId,
        error: blobCleanup.error,
      })
    }
    try {
      await workspaceDeletionRepository.settleBlobCleanup(
        receiptId,
        blobCleanup
      )
    } catch (error) {
      // The workspace is already gone — report success; the receipt keeps
      // its PENDING blob status as the trace of the unsettled cleanup.
      logger.error('[workspace-deletion] could not settle receipt', {
        receiptId,
        error: (error as Error).message,
      })
    }

    return { receiptId, rowCounts, blobCleanup }
  },

  /** LUM-918: the pending deletion of this workspace, if any. */
  async getPending(workspaceId: string) {
    return workspaceDeletionRepository.findPending(workspaceId)
  },

  /**
   * LUM-923: the pending-deletion section for agent context, or ''. Never
   * throws — a failed lookup must not break context injection.
   */
  async buildPendingNoticeSection(workspaceId: string): Promise<string> {
    try {
      return renderPendingDeletionSection(
        await workspaceDeletionRepository.findPending(workspaceId)
      )
    } catch (error) {
      logger.warn('[workspace-deletion] pending notice lookup failed', {
        workspaceId,
        error: (error as Error).message,
      })
      return ''
    }
  },

  /**
   * LUM-918: an OWNER's delete no longer purges at once — it schedules the
   * purge 48h out and emails every OWNER. 409 when one is already pending.
   */
  async scheduleDeletion(
    workspace: DeletionWorkspace,
    role: string,
    clerkId: string,
    now: Date = new Date()
  ): Promise<PendingDeletion> {
    requireOwner(role)
    const pending: PendingDeletion = {
      requestedAt: now,
      executeAt: new Date(now.getTime() + WORKSPACE_DELETION_GRACE_MS),
      requestedByClerkId: clerkId,
    }
    const scheduled = await workspaceDeletionRepository.schedule(
      workspace.id,
      pending
    )
    if (!scheduled) {
      throw httpError('Workspace deletion is already scheduled', 409)
    }
    await notifyOwners('scheduled', workspace, clerkId, pending)
    return pending
  },

  /** LUM-918: any OWNER cancels a pending deletion. 409 when none pending. */
  async cancelDeletion(
    workspace: DeletionWorkspace,
    role: string,
    clerkId: string
  ) {
    requireOwner(role)
    const pending = await workspaceDeletionRepository.findPending(workspace.id)
    const cancelled = await workspaceDeletionRepository.cancel(workspace.id)
    if (!pending || !cancelled) {
      throw httpError('No workspace deletion is scheduled', 409)
    }
    await notifyOwners('cancelled', workspace, clerkId, pending)
  },

  /**
   * LUM-918: the immediate-deletion path (e.g. a GDPR erasure request). Only
   * a deletion that is already pending can be run early, and the caller must
   * re-type the workspace name — two separate confirmations.
   */
  async deleteNow(
    workspace: DeletionWorkspace,
    role: string,
    clerkId: string,
    confirmName: string
  ) {
    requireOwner(role)
    if (confirmName !== workspace.name) {
      throw httpError('Workspace name does not match', 400)
    }
    const pending = await workspaceDeletionRepository.findPending(workspace.id)
    if (!pending) {
      throw httpError('No workspace deletion is scheduled', 409)
    }
    return this.deleteWorkspace(workspace.id, clerkId)
  },

  /**
   * LUM-918 cron: purge every workspace whose 48h window has passed. One
   * failure never stops the others; each purge re-checks it is still due.
   */
  async runDueDeletions(now: Date = new Date()) {
    const due = await workspaceDeletionRepository.findDue(now)
    let deleted = 0
    let skipped = 0
    let failed = 0
    for (const { workspaceId, requestedByClerkId } of due) {
      try {
        const out = await this.deleteWorkspace(
          workspaceId,
          requestedByClerkId,
          { dueBy: now }
        )
        if (out) deleted++
        else skipped++
      } catch (error) {
        failed++
        logger.error('[workspace-deletion] scheduled purge failed', {
          workspaceId,
          error: (error as Error).message,
        })
      }
    }
    return { due: due.length, deleted, skipped, failed }
  },
}
