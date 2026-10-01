/**
 * LUM-858 — durable GDPR workspace export. Builds the archive, keeps it
 * downloadable for EXPORT_TTL, then deletes it. Every exit removes the blob:
 * a failed build leaves none, a finished one is deleted when the window
 * closes. The download route also refuses past `expiresAt`, so access ends on
 * time even if this run's wake-up is late.
 */
import { sleep } from 'workflow'
import { EXPORT_TTL } from '@/lib/workspace/export-ttl'
import {
  expireWorkspaceExportStep,
  failWorkspaceExportStep,
  generateWorkspaceExportStep,
} from './workspace-export.steps'

export type WorkspaceExportOutcome =
  | { outcome: 'EXPIRED' }
  | { outcome: 'FAILED'; reason: string }

/**
 * `workspaceId` is optional only for runs started before LUM-923; with it a
 * step can delete the archive even after the export row went with a deleted
 * workspace.
 */
export async function workspaceExportWorkflow(
  exportId: string,
  workspaceId?: string
): Promise<WorkspaceExportOutcome> {
  'use workflow'

  try {
    await generateWorkspaceExportStep(exportId, workspaceId)
  } catch (error) {
    const reason = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 500)
    await failWorkspaceExportStep(exportId, reason, workspaceId)
    return { outcome: 'FAILED', reason }
  }

  await sleep(EXPORT_TTL)
  await expireWorkspaceExportStep(exportId, workspaceId)
  return { outcome: 'EXPIRED' }
}
