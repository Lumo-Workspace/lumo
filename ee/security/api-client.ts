/**
 * LUM-1062 / LUM-1065 — the security plugin's browser API client: the
 * workspace scan switches (moved out of lib/api-client/workspaces.ts) and the
 * task's scans and finding dispositions (moved out of lib/api-client/tasks.ts
 * and the core API path table). All of these URLs are plugin routes.
 */
import { apiFetch } from '@/lib/api-client/base'
import type {
  SecurityScanSettings,
  SecurityScanSettingsUpdate,
} from '@/ee/security/services/security-scan-settings.service'

export const SECURITY_API = {
  workspaceSecurityScan: '/api/workspaces/me/security-scan',
  taskSecurityScans: (taskId: string) => `/api/tasks/${taskId}/security-scans`,
  securityFindingDisposition: (taskId: string, findingId: string) =>
    `/api/tasks/${taskId}/security-findings/${findingId}/disposition`,
  securityFindingsBulkDisposition: (taskId: string) =>
    `/api/tasks/${taskId}/security-findings/bulk-disposition`,
} as const

export const securityScanClient = {
  /** LUM-1002: set the PR security-scan switches (`{ all }` = every one). */
  updateSecurityScan(data: SecurityScanSettingsUpdate) {
    return apiFetch<SecurityScanSettings>(SECURITY_API.workspaceSecurityScan, {
      method: 'PATCH',
      body: data,
    })
  },

  /** LUM-732: latest security scan per linked PR + DONE-blocking count. */
  securityScans<T>(taskId: string) {
    return apiFetch<T>(SECURITY_API.taskSecurityScans(taskId))
  },

  /** LUM-732: human-only disposition of one security finding. */
  dispositionSecurityFinding<T>(
    taskId: string,
    findingId: string,
    body: { disposition: 'FALSE_POSITIVE' | 'ACCEPTED_RISK'; note?: string }
  ) {
    return apiFetch<T>(
      SECURITY_API.securityFindingDisposition(taskId, findingId),
      {
        method: 'POST',
        body,
      }
    )
  },

  /** LUM-740: human-only — confirm every LLM-suggested false positive on the task. */
  bulkDispositionSecurityFindings<T>(taskId: string) {
    return apiFetch<T>(SECURITY_API.securityFindingsBulkDisposition(taskId), {
      method: 'POST',
      body: { disposition: 'FALSE_POSITIVE', scope: 'SUGGESTED' },
    })
  },
}
