import { apiFetch } from '@/lib/api-client'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GoogleDriveIntegrationStatus {
  connected: boolean
  email?: string | null
  needsReauth?: boolean
}

// ─── Client ─────────────────────────────────────────────────────────────────

export const googleDriveApi = {
  getStatus(): Promise<GoogleDriveIntegrationStatus> {
    return apiFetch<GoogleDriveIntegrationStatus>(API.googleDrive.status)
  },

  disconnect(): Promise<{ ok: true }> {
    return apiFetch(API.googleDrive.disconnect, {
      method: 'DELETE',
    })
  },
}
