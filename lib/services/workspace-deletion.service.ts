import {
  workspaceDeletionRepository,
  type BlobCleanup,
} from '@/lib/repositories/workspace-deletion.repository'
import { logger } from '@/lib/logger'

const ERROR_MAX_CHARS = 500

/** Blob prefixes a workspace owns: its logo folder and each task's evidence. */
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
    const { deleteBlobsByPrefix } =
      await import('@/lib/services/workspace-deletion-blob')
    for (const prefix of prefixes) deleted += await deleteBlobsByPrefix(prefix)
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

// ── Workspace Deletion Service (LUM-861) ────────────────────────────────────

export const workspaceDeletionService = {
  /**
   * Permanently delete a workspace and everything it owns, then its blobs.
   * The DB delete + receipt commit together; blob cleanup runs after the
   * commit and never rolls it back — its outcome is settled on the receipt.
   */
  async deleteWorkspace(workspaceId: string, requestedByClerkId: string) {
    const taskIds =
      await workspaceDeletionRepository.findTaskIdsWithTestCases(workspaceId)
    const { receiptId, rowCounts } = await workspaceDeletionRepository.purge(
      workspaceId,
      requestedByClerkId
    )

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
}
