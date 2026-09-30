/**
 * LUM-858 — `'use step'` boundaries for the workspace-export workflow. One-line
 * delegates so the service stays a plain, unit-testable module. Default retry
 * policy: generation is idempotent (a retry clears its own earlier upload).
 */
import { workspaceExportService } from '@/lib/services/workspace-export.service'

export async function generateWorkspaceExportStep(
  exportId: string
): Promise<void> {
  'use step'
  await workspaceExportService.generateArchive(exportId)
}

export async function expireWorkspaceExportStep(
  exportId: string
): Promise<void> {
  'use step'
  await workspaceExportService.expireExport(exportId)
}

export async function failWorkspaceExportStep(
  exportId: string,
  reason: string
): Promise<void> {
  'use step'
  await workspaceExportService.failExport(exportId, reason)
}
