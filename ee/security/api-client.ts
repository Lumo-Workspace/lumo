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
import type { PolicyCoverage } from '@/ee/security/services/policy-coverage.service'
import type {
  RepoReviewSettings,
  RepoReviewSettingsUpdate,
} from '@/ee/security/services/repo-review-settings.service'

export const SECURITY_API = {
  workspaceSecurityScan: '/api/workspaces/me/security-scan',
  workspacePolicyCoverage: '/api/workspaces/me/policy-coverage',
  workspaceRepoReviewSettings: '/api/workspaces/me/security-scan/repositories',
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

  /** LUM-1133: per-repository automatic PR review settings. */
  repoReviewSettings() {
    return apiFetch<RepoReviewSettings>(
      SECURITY_API.workspaceRepoReviewSettings
    )
  },

  /** LUM-1133: change one repository's review settings (OWNER). */
  updateRepoReviewSettings(data: RepoReviewSettingsUpdate) {
    return apiFetch<RepoReviewSettings>(
      SECURITY_API.workspaceRepoReviewSettings,
      { method: 'PATCH', body: data }
    )
  },

  /** LUM-1114: per project, the rules no detector checks automatically. */
  policyCoverage() {
    return apiFetch<PolicyCoverage>(SECURITY_API.workspacePolicyCoverage)
  },

  /** LUM-732: latest security scan per linked PR + DONE-blocking count. */
  securityScans<T>(taskId: string) {
    return apiFetch<T>(SECURITY_API.taskSecurityScans(taskId))
  },

  /** LUM-732: human-only disposition of one security finding. */
  dispositionSecurityFinding<T>(
    taskId: string,
    findingId: string,
    body: {
      /** `OPEN` reverts a ruling (web only, LUM-1128 follow-up). */
      disposition: 'FALSE_POSITIVE' | 'ACCEPTED_RISK' | 'OPEN'
      note?: string
    }
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
