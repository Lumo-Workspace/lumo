/**
 * LUM-858 — starts the durable workspace-export run. Never throws: a run that
 * could not be started returns null and the caller marks the export FAILED.
 */
import { start } from 'workflow/api'
import { logger } from '@/lib/logger'
import { workspaceExportWorkflow } from '@/lib/workflows/workspace-export'

export async function startWorkspaceExport(
  exportId: string,
  workspaceId: string
): Promise<string | null> {
  try {
    // workspaceId rides along (LUM-923) so every step can still find and
    // delete the archive after the export row went with its workspace.
    const run = await start(workspaceExportWorkflow, [exportId, workspaceId])
    return run.runId
  } catch (error) {
    logger.error(
      `[workspace-export] start failed export=${exportId}:`,
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}
