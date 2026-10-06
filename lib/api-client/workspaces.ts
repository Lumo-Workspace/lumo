import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type { WorkspaceExportView } from '@/lib/services/workspace-export.service'
import type {
  AiDerivedContentStatus,
  AiDerivedPurgeResult,
} from '@/lib/services/ai-derived-content.service'
import type {
  SecurityScanSettings,
  SecurityScanSettingsUpdate,
} from '@/lib/services/security-scan-settings.service'

/** LUM-918: a scheduled workspace deletion as the API returns it. */
export interface PendingDeletionView {
  requestedAt: string
  executeAt: string
  requestedByClerkId: string
}

export const workspacesClient = {
  create<T>(data: unknown) {
    return apiFetch<T>('/api/workspaces', { method: 'POST', body: data })
  },

  getMe<T>() {
    return apiFetch<T>(API.workspaces.me)
  },

  updateMe<T>(data: unknown) {
    return apiFetch<T>(API.workspaces.me, { method: 'PATCH', body: data })
  },

  /** LUM-1002: set the PR security-scan switches (`{ all }` = every one). */
  updateSecurityScan(data: SecurityScanSettingsUpdate) {
    return apiFetch<SecurityScanSettings>(API.workspaces.securityScan, {
      method: 'PATCH',
      body: data,
    })
  },

  uploadLogo(formData: FormData): Promise<Response> {
    return fetch(API.workspaces.logo, {
      method: 'POST',
      body: formData,
    })
  },

  listMembers<T>() {
    return apiFetch<T>(API.workspaces.members)
  },

  updateMember<T>(id: string, data: unknown) {
    return apiFetch<T>(API.workspaces.memberById(id), {
      method: 'PATCH',
      body: data,
    })
  },

  removeMember(id: string) {
    return apiFetch<void>(API.workspaces.memberById(id), { method: 'DELETE' })
  },

  leaveWorkspace() {
    return apiFetch<void>(API.workspaces.leaveWorkspace, { method: 'DELETE' })
  },

  /** LUM-858: recent GDPR exports (OWNER only). */
  listExports() {
    return apiFetch<{ exports: WorkspaceExportView[] }>(API.workspaces.exports)
  },

  /** LUM-858: start an export; returns the in-progress one if any. */
  startExport() {
    return apiFetch<{ export: WorkspaceExportView; started: boolean }>(
      API.workspaces.exports,
      { method: 'POST' }
    )
  },

  /** LUM-858: same-origin URL the browser follows to download the zip. */
  exportDownloadUrl(id: string) {
    return API.workspaces.exportDownload(id)
  },

  /** LUM-918: schedule deletion 48h out (OWNER only). */
  scheduleDeletion() {
    return apiFetch<{ pendingDeletion: PendingDeletionView }>(
      API.workspaces.me,
      { method: 'DELETE' }
    )
  },

  /** LUM-918: cancel the pending deletion (any OWNER). */
  cancelDeletion() {
    return apiFetch<{ pendingDeletion: null }>(API.workspaces.deletion, {
      method: 'DELETE',
    })
  },

  /** LUM-917: the AI-derived content switch and stored counts (OWNER only). */
  getAiDerivedContent() {
    return apiFetch<AiDerivedContentStatus>(API.workspaces.aiDerivedContent)
  },

  /**
   * LUM-917: one batched pass of deleting AI-derived content; call again
   * while `done` is false. The workspace name must be re-typed.
   */
  purgeAiDerivedContent(confirmName: string) {
    return apiFetch<AiDerivedPurgeResult>(API.workspaces.aiDerivedContent, {
      method: 'POST',
      body: { confirmName },
    })
  },

  /** LUM-918: run the pending deletion now; the name must be re-typed. */
  deleteNow(confirmName: string) {
    return apiFetch<{ receiptId: string | null }>(API.workspaces.deletion, {
      method: 'POST',
      body: { confirmName },
    })
  },
}
