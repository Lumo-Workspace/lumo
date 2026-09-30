/**
 * LUM-858 — starts the durable workspace-export run. Never throws: a run that
 * could not be started returns null and the caller marks the export FAILED.
 */
import { start } from 'workflow/api'
import { logger } from '@/lib/logger'
import { workspaceExportWorkflow } from '@/lib/workflows/workspace-export'

export async function startWorkspaceExport(
  exportId: string
): Promise<string | null> {
  try {
    const run = await start(workspaceExportWorkflow, [exportId])
    return run.runId
  } catch (error) {
    logger.error(
      `[workspace-export] start failed export=${exportId}:`,
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}
